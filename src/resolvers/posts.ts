import {
    Mutation,
    Query,
    Resolver,
    Arg,
    Int,
    InputType,
    Field,
    Ctx,
    UseMiddleware,
    Root,
    FieldResolver
} from 'type-graphql'
import { Post } from '../entities/Post'
import { isAuth } from '../middleware/isAuth'
import { MyContext } from '../types'

@InputType()
export class PostInput {
    @Field(() => String)
    title: string

    @Field(() => String)
    text: string
}

@Resolver(Post)
export class PostResolver {
    @FieldResolver(() => String)
    textSnippet(@Root() post: Post) {
        return post.text.slice(0, 50)
    }

    @Query(() => [Post])
    posts(
        @Arg('limit', () => Int) limit: number,
        @Arg('cursor', () => String, { nullable: true }) cursor: string | null
    ): Promise<Post[]> {
        const realLimit = Math.min(30, limit)

        const qb = Post.getRepository()
            .createQueryBuilder('p')
            .orderBy('"createdAt"', 'DESC')
            .take(realLimit)

        if (cursor)
            qb.where('"createdAt" < :cursor', {
                cursor: new Date(parseInt(cursor))
            })

        return qb.getMany()
    }

    @Query(() => Post, { nullable: true })
    post(@Arg('id', () => Int) id: number): Promise<Post | null> {
        return Post.findOne({ where: { id } })
    }

    @Mutation(() => Post)
    @UseMiddleware(isAuth)
    async createPost(
        @Arg('input') input: PostInput,
        @Ctx() { req }: MyContext
    ): Promise<Post> {
        return Post.create({
            ...input,
            creatorId: req.session.userId
        }).save()
    }

    @Mutation(() => Post, { nullable: true })
    async updatePost(
        @Arg('id', () => Int) id: number,
        @Arg('title', () => String, { nullable: true }) title: string
    ): Promise<Post | null> {
        const post = await Post.findOne({ where: { id } })
        if (!post) return null
        if (typeof title !== 'undefined') {
            // post.title = title; await Post.save(post)
            // above method is inefficient because it first checks whether entity exist in the database

            await Post.update({ id }, { title })
        }
        return post
    }

    @Mutation(() => Boolean)
    async deletePost(@Arg('id') id: number): Promise<Boolean> {
        await Post.delete({ id })
        return true
    }
}
