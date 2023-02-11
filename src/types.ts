import { Request, Response } from 'express'
import session from 'express-session'
import { Redis } from 'ioredis'
import { DataSource } from 'typeorm'

export type MyContext = {
    req: Request & {
        session: session.Session &
            Partial<session.SessionData> & { userId?: number }
    }
    res: Response
    redis: Redis
    dataSource: DataSource
}
