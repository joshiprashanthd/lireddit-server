import { EntityManager } from '@mikro-orm/postgresql'
import argon2 from 'argon2'
import { nanoid } from 'nanoid'
import {
    Arg,
    Ctx,
    Field,
    Mutation,
    ObjectType,
    Query,
    Resolver
} from 'type-graphql'

import { COOKIE_NAME, FORGET_PASSWORD_PREFIX } from '../constants'
import { User } from '../entities/User'
import { MyContext } from '../types'
import { sendEmail } from '../utils/sendEmail'
import { validateRegister } from '../utils/validateRegister'
import { UsernamePasswordInput } from './UsernamePasswordInput'

@ObjectType()
class FieldError {
    @Field()
    field: string

    @Field()
    message: string
}

@ObjectType()
class UserResponse {
    @Field(() => [FieldError], { nullable: true })
    errors?: FieldError[]

    @Field(() => User, { nullable: true })
    user?: User
}

@Resolver()
export class UserResolver {
    @Mutation(() => UserResponse)
    async register(
        @Arg('options') options: UsernamePasswordInput,
        @Ctx() { em, req }: MyContext
    ): Promise<UserResponse> {
        const errors = validateRegister(options)
        if (errors) return { errors }

        const hashedPassword = await argon2.hash(options.password)
        let user: User

        try {
            const result = await (em as EntityManager)
                .createQueryBuilder(User)
                .getKnexQuery()
                .insert({
                    username: options.username,
                    password: hashedPassword,
                    email: options.email,
                    created_at: new Date(),
                    updated_at: new Date()
                })
                .returning('*')

            user = result[0]
        } catch (err) {
            if (err.code === '23505') {
                //duplicate username
                return {
                    errors: [
                        {
                            field: 'username',
                            message: 'username already exists'
                        }
                    ]
                }
            } else {
                return {
                    errors: [
                        {
                            field: '*',
                            message: 'An error from database occurred.'
                        }
                    ]
                }
            }
        }
        req.session.userId = user.id
        return {
            user
        }
    }

    @Mutation(() => UserResponse)
    async login(
        @Arg('usernameOrEmail') usernameOrEmail: string,
        @Arg('password') password: string,
        @Ctx() { em, req }: MyContext
    ): Promise<UserResponse> {
        const user = await em.findOne(
            User,
            usernameOrEmail.includes('@')
                ? { email: usernameOrEmail }
                : { username: usernameOrEmail }
        )

        if (!user) {
            return {
                errors: [
                    {
                        field: 'usernameOrEmail',
                        message: `Incorrect username or email'`
                    }
                ]
            }
        }

        const valid = await argon2.verify(user.password, password)
        if (!valid) {
            return {
                errors: [
                    {
                        field: 'password',
                        message: 'Incorrect password'
                    }
                ]
            }
        }

        req.session!.userId = user.id

        return {
            user
        }
    }

    @Mutation(() => Boolean)
    async logout(@Ctx() { req, res }: MyContext): Promise<Boolean> {
        return new Promise<Boolean>((resolve) =>
            req.session.destroy((err) => {
                if (err) resolve(false)
                else {
                    res.clearCookie(COOKIE_NAME)
                    resolve(true)
                }
            })
        )
    }

    @Mutation(() => Boolean)
    async forgotPassword(
        @Arg('email') email: string,
        @Ctx() { em, redis }: MyContext
    ) {
        if (!email.includes('@')) return false

        const user = await em.findOne(User, { email })
        if (!user) return false

        const token = nanoid()

        await redis.set(
            FORGET_PASSWORD_PREFIX + token,
            user.id,
            'EX',
            1000 * 60 * 60 * 24 * 3
        )
        sendEmail(
            email,
            `<a href="http://localhost:3000/change-password/${token}">Reset Password</a>"`
        )
        return true
    }

    @Mutation(() => UserResponse)
    async changePassword(
        @Arg('token') token: string,
        @Arg('newPassword') newPassword: string,
        @Ctx() { em, redis, req }: MyContext
    ): Promise<UserResponse> {
        if (newPassword.length <= 7)
            return {
                errors: [
                    {
                        field: 'newPassword',
                        message: 'password must be atleast 8 characters long'
                    }
                ]
            }

        const userId = await redis.get(FORGET_PASSWORD_PREFIX + token)
        if (!userId) {
            return {
                errors: [
                    {
                        field: 'token',
                        message: 'Token Expired'
                    }
                ]
            }
        }

        const user = await em.findOne(User, { id: parseInt(userId) })

        if (!user) {
            return {
                errors: [
                    {
                        field: 'token',
                        message: 'Token Invalid'
                    }
                ]
            }
        }

        user.password = await argon2.hash(newPassword)
        await em.persistAndFlush(user)

        req.session.userId = user.id

        await redis.del(FORGET_PASSWORD_PREFIX + token)

        return {
            user
        }
    }

    @Query(() => User, { nullable: true })
    async currentUser(@Ctx() { em, req }: MyContext): Promise<User | null> {
        if (!req.session.userId) return null
        return await em.findOne(User, { id: req.session.userId })
    }
}
