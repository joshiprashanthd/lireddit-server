import { MikroORM } from '@mikro-orm/core'
import { __prod__ } from './constants'
import mikroOrmConfig from './mikro-orm.config'
import express from 'express'
import { ApolloServer } from 'apollo-server-express'
import { buildSchema } from 'type-graphql'
import { HelloResolver } from './resolvers/hello'
import { PostResolver } from './resolvers/posts'
import { UserResolver } from './resolvers/user'

import { createClient } from 'redis'
import session from 'express-session'
import connectRedis from 'connect-redis'
import { MyContext } from './types'

const main = async () => {
    const orm = await MikroORM.init(mikroOrmConfig)
    await orm.getMigrator().up()

    const app = express()
    app.set('trust proxy', !__prod__) // important for session persistence

    const RedisStore = connectRedis(session)
    const redisClient = createClient({ legacyMode: true })
    await redisClient.connect()

    app.use(
        session({
            name: 'qid',
            store: new RedisStore({
                client: redisClient as any,
                disableTouch: true,
            }),
            cookie: {
                maxAge: 1000 * 60 * 60 * 24 * 8,
                httpOnly: true,
                secure: true, // cookie only works in https, if you using http instead of https on production, remember to disable this setting
                sameSite: 'none',
            },
            secret: 'anything is nothing',
            resave: false,
            saveUninitialized: false,
        })
    )

    const apolloServer = new ApolloServer({
        schema: await buildSchema({
            resolvers: [HelloResolver, PostResolver, UserResolver],
            validate: false,
        }),
        context: ({ req, res }): MyContext => ({ em: orm.em, req, res }),
    })

    await apolloServer.start()

    apolloServer.applyMiddleware({
        app,
        cors: {
            credentials: true,
            origin: [
                'https://studio.apollographql.com',
                'http://localhost:3000',
            ],
        },
    })

    app.listen(4000, () => {
        console.log('server started on localhost:4000')
    })
}

main()
