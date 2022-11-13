import nodemailer from 'nodemailer'

export async function sendEmail(to: string, text: string) {
    // let testAccount = await nodemailer.createTestAccount()
    // console.log('test account: ', testAccount)

    let transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
            user: 'nkmjs5xk2quqopus@ethereal.email',
            pass: 'kt3s4GYUXsFyFVbF3r'
        }
    })

    let info = await transporter.sendMail({
        from: 'Prashant Joshi CEO',
        to: to,
        subject: 'Forgot Password',
        html: text
    })

    console.log('Sent email: ', info)

    console.log('Preview URL : ', nodemailer.getTestMessageUrl(info))
}
