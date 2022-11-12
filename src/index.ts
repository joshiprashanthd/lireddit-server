import { MikroORM } from '@mikro-orm/core'
import { COOKIE_NAME, __prod__ } from './constants'
import mikroOrmConfig from './mikro-orm.config'
import express from 'express'
import http from 'http'
import { json } from 'body-parser'
import cors from 'cors'

import { expressMiddleware } from '@apollo/server/express4'
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer'
import { ApolloServerPluginLandingPageGraphQLPlayground } from '@apollo/server-plugin-landing-page-graphql-playground'
import { ApolloServer } from '@apollo/server'
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
    const httpServer = http.createServer(app)

    const RedisStore = connectRedis(session)
    const redisClient = createClient({ legacyMode: true })
    await redisClient.connect()

    const apolloServer = new ApolloServer({
        schema: await buildSchema({
            resolvers: [HelloResolver, PostResolver, UserResolver],
            validate: false
        }),
        plugins: [
            ApolloServerPluginDrainHttpServer({ httpServer }),
            ApolloServerPluginLandingPageGraphQLPlayground()
        ]
    })

    await apolloServer.start()

    app.use(
        '/graphql',
        cors<cors.CorsRequest>({
            credentials: true,
            origin: ['http://localhost:3000']
        }),
        json(),
        session({
            name: COOKIE_NAME,
            store: new RedisStore({
                client: redisClient as any,
                disableTouch: true
            }),
            cookie: {
                maxAge: 1000 * 60 * 60 * 24 * 8,
                httpOnly: true,
                secure: false,
                sameSite: 'lax'
            },
            secret: 'anything is nothing',
            resave: false,
            saveUninitialized: false
        }),
        expressMiddleware(apolloServer, {
            context: async ({ req, res }) =>
                ({
                    em: orm.em,
                    req,
                    res
                } as MyContext)
        })
    )

    await new Promise<void>((resolve) =>
        httpServer.listen({ port: 4000 }, resolve)
    )
    console.log(`🚀 Server ready at http://localhost:4000/graphql`)
}

main()
