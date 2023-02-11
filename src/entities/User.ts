import { ObjectType, Field, Int } from 'type-graphql'
import {
    BaseEntity,
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from 'typeorm'
import { Post } from './Post'
import { Updoot } from './updoot'

@ObjectType()
@Entity()
export class User extends BaseEntity {
    @Field(() => Int)
    @PrimaryGeneratedColumn()
    id!: number

    @Field(() => String)
    @Column({ unique: true })
    username!: string

    @Field(() => String)
    @Column({ unique: true })
    email!: string

    @Column()
    password!: string

    @Field(() => [Post])
    @OneToMany(() => Post, (post) => post.creator)
    posts: Post[]

    @OneToMany(() => Updoot, (updoot) => updoot.user, {
        onDelete: 'CASCADE'
    })
    updoots: Updoot[]

    @Field(() => String)
    @CreateDateColumn()
    createdAt: Date

    @Field(() => String)
    @UpdateDateColumn()
    updatedAt: Date
}
