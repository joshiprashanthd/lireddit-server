import DataLoader from 'dataloader'
import { Updoot } from '../entities/Updoot'
export const createUpdootLoader = () =>
    new DataLoader<{ userId: number; postId: number }, Updoot | null>(
        async (userAndPostIds) => {
            const updoots = await Updoot.createQueryBuilder('updoot')
                .select('updoot')
                .whereInIds(userAndPostIds)
                .getMany()
            const idToUpdoots: Record<string, Updoot> = {}
            updoots.forEach((u) => (idToUpdoots[`${u.postId}-${u.userId}`] = u))

            return userAndPostIds.map(
                ({ userId, postId }) => idToUpdoots[`${postId}-${userId}`]
            )
        }
    )
