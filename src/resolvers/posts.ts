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
import { Updoot } from '../entities/updoot'
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
        return post.text.slice(0, 50)
    }

    @FieldResolver(() => Int, { nullable: true })
    async voteStatus(
        @Root() post: Post,
        @Ctx() { req }: MyContext
    ): Promise<number | null> {
        if (!req.session.userId) return null
        const updoot = await Updoot.findOne({
            where: {
                userId: req.session.userId,
                postId: post.id
            }
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

        const qb = Post.createQueryBuilder('post')
            .select('post')
            .innerJoinAndSelect('post.creator', 'user')
            .orderBy('post.createdAt', 'DESC')
            .take(realLimitPlusOne)

        if (cursor)
            qb.where('post.createdAt < :cursor', {
                cursor: new Date(parseInt(cursor))
            })

        const posts = await qb.getMany()

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
    async updatePost(
        @Arg('id', () => Int) id: number,
        @Arg('title', () => String, { nullable: true }) title: string,
        @Arg('text', () => String, { nullable: true }) text: string
    ): Promise<Post | null> {
        const post = await Post.findOne({ where: { id } })
        if (!post) return null
        post.title = title ?? post.title
        post.text = text ?? post.text
        await Post.update({ id }, { title, text })
        return post
    }

    @Mutation(() => Boolean)
    async deletePost(@Arg('id') id: number): Promise<Boolean> {
        const result = await Post.delete({ id })
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
                await queryRunner.manager.save(updoot)

                post.points = post.points + 2 * realValue
                await queryRunner.manager.save(post)
                // if already voted but user wants to undo the voting
            } else if (updoot && updoot.value == realValue) {
                await queryRunner.manager.delete(Updoot, {
                    userId: updoot.userId,
                    postId: updoot.postId
                })
                post.points = post.points - realValue
                await queryRunner.manager.save(post)

                // post is not yet voted by user
            } else {
                const updoot = Updoot.create({
                    userId,
                    postId,
                    value: realValue
                })
                await queryRunner.manager.save(updoot)

                post!.points = post!.points + realValue
                await queryRunner.manager.save(post)
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
