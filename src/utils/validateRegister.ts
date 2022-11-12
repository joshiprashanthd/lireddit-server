import { UsernamePasswordInput } from '../resolvers/UsernamePasswordInput'

export const validateRegister = (options: UsernamePasswordInput) => {
    if (!options.email.includes('@')) {
        return [
            {
                field: 'email',
                message: 'Invalid email',
            },
        ]
    }

    if (options.username.length <= 3) {
        return [
            {
                field: 'username',
                message: 'username must be atleast 4 characters long',
            },
        ]
    }

    if (options.username.includes('@')) {
        return [
            {
                field: 'username',
                message: 'username must include only alphanumeric characters',
            },
        ]
    }

    if (options.password.length <= 7) {
        return [
            {
                field: 'password',
                message: 'password must be atleast 8 characters long',
            },
        ]
    }

    return null
}
