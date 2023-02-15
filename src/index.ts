import 'reflect-metadata'
import { ApolloServer } from '@apollo/server'
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

import { COOKIE_NAME, DATABASE_URL, PROD, REDIS_URL } from './constants'
import { Post } from './entities/Post'
import { User } from './entities/User'
import { MyContext } from './types'
import { Updoot } from './entities/Updoot'
import { createUserLoader } from './utils/createUserLoader'
import { createUpdootLoader } from './utils/createUpdootLoader'
import path from 'path'

const main = async () => {
    const AppDataSource = new DataSource({
        type: 'postgres',
        url: DATABASE_URL,
        entities: [User, Post, Updoot],
        migrations: [path.join(__dirname, './migrations/*')],
        synchronize: !PROD,
        logging: !PROD
    })
    let dataSource: DataSource

    try {
        dataSource = await AppDataSource.initialize()
        await dataSource.runMigrations()
    } catch (err) {
        console.log('app data source initialize error: ', err)
    }

    const app = express()
    app.set('trust proxy', PROD) // important for session persistence
    const httpServer = http.createServer(app)

    const RedisStore = connectRedis(session)
    const redis = new Redis(REDIS_URL!)

    const apolloServer = new ApolloServer({
        schema: await buildSchema({
            resolvers: [HelloResolver, PostResolver, UserResolver],
            validate: false
        }),
        csrfPrevention: true,
        plugins: [ApolloServerPluginDrainHttpServer({ httpServer })]
    })
    try {
        await apolloServer.start()
    } catch (err) {
        console.log('apolloserver.start error: ', err)
    }

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
                secure: PROD,
                sameSite: 'none'
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

    const port = process.env.PORT || 8080
    try {
        await new Promise<void>((resolve) =>
            httpServer.listen({ host: '0.0.0.0', port }, resolve)
        )
    } catch (err) {
        console.log('http server resolve error: ', err)
    }

    console.log(`🚀 Server ready`)
}

main().catch((err) => {
    console.log('Found Errors: ', err)
})
