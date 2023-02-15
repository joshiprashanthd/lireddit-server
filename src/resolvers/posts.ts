import {
    Arg,
    Ctx,
    Field,
    FieldResolver,
    InputType,
    Int,
    Mutation,
    ObjectType,
    Query,
    Resolver,
    Root,
    UseMiddleware
} from 'type-graphql'
import { Post } from '../entities/Post'
import { Updoot } from '../entities/Updoot'
import { User } from '../entities/User'
import { isAuth } from '../middleware/isAuth'
import { MyContext } from '../types'

@ObjectType()
class PaginatedPosts {
    @Field(() => [Post])
    posts: Post[]

    @Field(() => Boolean)
    hasMore: boolean
}

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
        return post.text.slice(0, 140)
    }

    @FieldResolver(() => User)
    creator(
        @Root() post: Post,
        @Ctx() { userLoader }: MyContext
    ): Promise<User | null> {
        return userLoader.load(post.creatorId)
    }

    @FieldResolver(() => Int, { nullable: true })
    async voteStatus(
        @Root() post: Post,
        @Ctx() { req, updootLoader }: MyContext
    ): Promise<number | null> {
        if (!req.session.userId) return null
        const updoot = await updootLoader.load({
            userId: req.session.userId,
            postId: post.id
        })
        return updoot ? updoot.value : null
    }

    @Query(() => PaginatedPosts)
    async posts(
        @Arg('limit', () => Int) limit: number,
        @Arg('cursor', () => String, { nullable: true }) cursor: string | null
    ): Promise<PaginatedPosts> {
        const realLimit = Math.min(30, limit)
        const realLimitPlusOne = realLimit + 1

        console.log('in posts resolver')

        const qb = Post.createQueryBuilder('post')
            .select('post')
            .orderBy('post.createdAt', 'DESC')
            .take(realLimitPlusOne)

        if (cursor)
            qb.where('post.createdAt < :cursor', {
                cursor: new Date(parseInt(cursor))
            })

        const posts = await qb.getMany()
        console.log('posts: ', [posts])

        return {
            posts: posts.slice(0, realLimit),
            hasMore: posts.length === realLimitPlusOne
        }
    }

    @Query(() => Post, { nullable: true })
    post(@Arg('id', () => Int) id: number): Promise<Post | null> {
        return Post.findOne({
            where: {
                id
            }
        })
    }

    @Mutation(() => Post)
    @UseMiddleware(isAuth)
    async createPost(
        @Arg('input') input: PostInput,
        @Ctx() { req }: MyContext
    ): Promise<Post> {
        const post = Post.create({
            title: input.title,
            text: input.text,
            creatorId: req.session.userId
        })
        await post.save()
        return post
    }

    @Mutation(() => Post, { nullable: true })
    @UseMiddleware(isAuth)
    async updatePost(
        @Arg('id', () => Int) id: number,
        @Arg('title', () => String, { nullable: true }) title: string,
        @Arg('text', () => String, { nullable: true }) text: string,
        @Ctx() { req }: MyContext
    ): Promise<Post | null> {
        const result = await Post.createQueryBuilder('post')
            .update({ title, text })
            .where('id = :id AND creatorId = :creatorId', {
                id,
                creatorId: req.session.userId
            })
            .returning('*')
            .execute()
        return result.raw[0]
    }

    @Mutation(() => Boolean)
    @UseMiddleware(isAuth)
    async deletePost(
        @Arg('id', () => Int) id: number,
        @Ctx() { req }: MyContext
    ): Promise<Boolean> {
        const result = await Post.delete({ id, creatorId: req.session.userId })
        return result.affected! > 0
    }

    @Mutation(() => Int, { nullable: true })
    @UseMiddleware(isAuth)
    async vote(
        @Arg('postId', () => Int) postId: number,
        @Arg('value', () => Int) value: number,
        @Ctx() { req, dataSource }: MyContext
    ): Promise<number | null> {
        const { userId } = req.session
        const isUpdoot = value !== -1
        const realValue = isUpdoot ? 1 : -1

        const updoot = await Updoot.findOne({
            where: {
                userId,
                postId
            }
        })

        const post = await Post.findOne({
            where: {
                id: postId
            }
        })
        if (!post) return null

        const queryRunner = dataSource.createQueryRunner()
        await queryRunner.connect()
        await queryRunner.startTransaction()

        try {
            // if already voted but the now voting value is different from previous voting value
            if (updoot && updoot.value != realValue) {
                updoot.value = realValue
                await queryRunner.manager.update(
                    Updoot,
                    { userId: updoot.userId, postId: updoot.postId },
                    { value: realValue }
                )

                post.points = post.points + 2 * realValue
                await queryRunner.manager.update(
                    Post,
                    { id: post.id },
                    { points: post.points }
                )
                // if already voted but user wants to undo the voting
            } else if (updoot && updoot.value == realValue) {
                await queryRunner.manager.delete(Updoot, {
                    userId: updoot.userId,
                    postId: updoot.postId
                })
                post.points = post.points - realValue
                await queryRunner.manager.update(
                    Post,
                    { id: post.id },
                    { points: post.points }
                )

                // post is not yet voted by user
            } else {
                const updoot = Updoot.create({
                    userId,
                    postId,
                    value: realValue
                })
                await queryRunner.manager.insert(Updoot, updoot)

                post!.points = post!.points + realValue
                await queryRunner.manager.update(
                    Post,
                    { id: post.id },
                    { points: post.points }
                )
            }
            await queryRunner.commitTransaction()
        } catch (err) {
            await queryRunner.rollbackTransaction()
        } finally {
            await queryRunner.release()
        }

        return post.points
    }
}
