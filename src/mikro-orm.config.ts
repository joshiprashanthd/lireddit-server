import { Options, IDatabaseDriver, Connection } from '@mikro-orm/core'
import { __prod__ } from './constants'
import { Post } from './entities/Post'
import path from 'path'
import { User } from './entities/User'

export default <Options<IDatabaseDriver<Connection>>>{
    migrations: {
        path: path.join(__dirname, './migrations'),
    },
    entities: [Post, User],
    dbName: 'lireddit',
    type: 'postgresql',
    debug: !__prod__,
    allowGlobalContext: true,
}
