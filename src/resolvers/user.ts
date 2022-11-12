import {
    Arg,
    Ctx,
    Field,
    Mutation,
    ObjectType,
    Query,
    Resolver
} from 'type-graphql'
import { User } from '../entities/User'
import { MyContext } from '../types'
import argon2 from 'argon2'
import { EntityManager } from '@mikro-orm/postgresql'
import { COOKIE_NAME } from '../constants'
import { UsernamePasswordInput } from './UsernamePasswordInput'
import { validateRegister } from '../utils/validateRegister'

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
        @Ctx() { em }: MyContext
    ) {
        return true
    }

    @Query(() => User, { nullable: true })
    async currentUser(@Ctx() { em, req }: MyContext): Promise<User | null> {
        if (!req.session.userId) return null
        return await em.findOne(User, { id: req.session.userId })
    }
}
