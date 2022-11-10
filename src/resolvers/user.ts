import {
    Arg,
    Ctx,
    Field,
    InputType,
    Mutation,
    ObjectType,
    Query,
    Resolver,
} from 'type-graphql'
import { User } from '../entities/User'
import { MyContext } from '../types'
import argon2 from 'argon2'
import { EntityManager } from '@mikro-orm/postgresql'
import { COOKIE_NAME } from '../constants'

@InputType()
export class UsernamePasswordInput {
    @Field()
    username!: string

    @Field()
    password!: string
}

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
        if (options.username.length <= 3) {
            return {
                errors: [
                    {
                        field: 'username',
                        message: 'username must be atleast 4 characters long',
                    },
                ],
            }
        }

        if (options.password.length <= 7) {
            return {
                errors: [
                    {
                        field: 'password',
                        message: 'password must be atleast 8 characters long',
                    },
                ],
            }
        }

        const hashedPassword = await argon2.hash(options.password)
        let user: User

        try {
            const result = await (em as EntityManager)
                .createQueryBuilder(User)
                .getKnexQuery()
                .insert({
                    username: options.username,
                    password: hashedPassword,
                    created_at: new Date(),
                    updated_at: new Date(),
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
                            message: 'username already exists',
                        },
                    ],
                }
            } else {
                return {
                    errors: [
                        {
                            field: '*',
                            message: 'An error from database occurred.',
                        },
                    ],
                }
            }
        }
        req.session.userId = user.id
        return {
            user,
        }
    }

    @Mutation(() => UserResponse)
    async login(
        @Arg('options') options: UsernamePasswordInput,
        @Ctx() { em, req }: MyContext
    ): Promise<UserResponse> {
        const user = await em.findOne(User, { username: options.username })
        if (!user) {
            return {
                errors: [
                    {
                        field: 'username',
                        message: `Incorrect username '${options.username}'`,
                    },
                ],
            }
        }

        const valid = await argon2.verify(user.password, options.password)
        if (!valid) {
            return {
                errors: [
                    {
                        field: 'password',
                        message: 'Incorrect password',
                    },
                ],
            }
        }

        req.session!.userId = user.id

        return {
            user,
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

    @Query(() => User, { nullable: true })
    async currentUser(@Ctx() { em, req }: MyContext): Promise<User | null> {
        if (!req.session.userId) return null
        return await em.findOne(User, { id: req.session.userId })
    }
}
