import 'reflect-metadata'
import { ApolloServer } from '@apollo/server'
import { ApolloServerPluginLandingPageGraphQLPlayground } from '@apollo/server-plugin-landing-page-graphql-playground'
import { expressMiddleware } from '@apollo/server/express4'
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer'
import { json } from 'body-parser'

import connectRedis from 'connect-redis'
import cors from 'cors'
import express from 'express'
import session from 'express-session'
import http from 'http'
import Redis from 'ioredis'

import { buildSchema } from 'type-graphql'
import { DataSource } from 'typeorm'

import { HelloResolver } from './resolvers/hello'
import { PostResolver } from './resolvers/posts'
import { UserResolver } from './resolvers/user'

import { COOKIE_NAME, __prod__ } from './constants'
import { Post } from './entities/Post'
import { User } from './entities/User'
import { MyContext } from './types'
import { Updoot } from './entities/updoot'
import { createUserLoader } from './utils/createUserLoader'
import { createUpdootLoader } from './utils/createUpdootLoader'

const main = async () => {
    const AppDataSource = new DataSource({
        type: 'postgres',
        port: 5432,
        database: 'lireddit2',
        entities: [User, Post, Updoot],
        synchronize: true,
        logging: true
    })

    const dataSource = await AppDataSource.initialize()

    const app = express()
    app.set('trust proxy', !__prod__) // important for session persistence
    const httpServer = http.createServer(app)

    const RedisStore = connectRedis(session)
    const redis = Redis.createClient()

    const apolloServer = new ApolloServer({
        schema: await buildSchema({
            resolvers: [HelloResolver, PostResolver, UserResolver],
            validate: false
        }),
        plugins: [
            ApolloServerPluginDrainHttpServer({ httpServer }),
            ApolloServerPluginLandingPageGraphQLPlayground({
                settings: {
                    'request.credentials': 'include'
                }
            })
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
                client: redis as any,
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
                    req,
                    res,
                    redis,
                    dataSource,
                    userLoader: createUserLoader(),
                    updootLoader: createUpdootLoader()
                } as MyContext)
        })
    )

    await new Promise<void>((resolve) =>
        httpServer.listen({ port: 4000 }, resolve)
    )
    console.log(`🚀 Server ready at http://localhost:4000/graphql`)
}

main()
