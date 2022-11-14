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
        @Ctx() { req }: MyContext
    ): Promise<UserResponse> {
        const errors = validateRegister(options)
        if (errors) return { errors }

        const hashedPassword = await argon2.hash(options.password)

        let user: User

        try {
            // const result = await User.createQueryBuilder()
            //     .insert()
            //     .values({
            //         username: options.username,
            //         email: options.email,
            //         password: hashedPassword
            //     })
            //     .returning('*')
            //     .execute()
            // user = result.raw[0]

            user = await User.create({
                ...options,
                password: hashedPassword
            }).save()
        } catch (err) {
            if (
                err.detail.includes('already exists') &&
                err.detail.includes('email')
            ) {
                return {
                    errors: [
                        {
                            field: 'email',
                            message: 'Email already taken'
                        }
                    ]
                }
            } else if (
                err.detail.includes('already exists') &&
                err.detail.includes('username')
            ) {
                return {
                    errors: [
                        {
                            field: 'username',
                            message: 'Username already taken'
                        }
                    ]
                }
            } else {
                return {
                    errors: [
                        {
                            field: 'unknown',
                            message: 'Error not recognized'
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
        @Ctx() { req }: MyContext
    ): Promise<UserResponse> {
        const user = await User.findOne(
            usernameOrEmail.includes('@')
                ? { where: { email: usernameOrEmail } }
                : { where: { username: usernameOrEmail } }
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
        @Ctx() { redis }: MyContext
    ) {
        if (!email.includes('@')) return false

        const user = await User.findOne({ where: { email } })
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
        @Ctx() { redis, req }: MyContext
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
        const key = FORGET_PASSWORD_PREFIX + token
        const userId = await redis.get(key)
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

        const user = await User.findOne({
            where: { id: parseInt(userId) }
        })

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

        await User.update(
            { id: parseInt(userId) },
            { password: await argon2.hash(newPassword) }
        )

        req.session.userId = parseInt(userId)

        await redis.del(key)

        return {
            user
        }
    }

    @Query(() => User, { nullable: true })
    async currentUser(@Ctx() { req }: MyContext): Promise<User | null> {
        if (!req.session.userId) return null
        return User.findOne({ where: { id: req.session.userId } })
    }
}
