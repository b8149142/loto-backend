const nodemailer = require("nodemailer");

class MailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      // secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }

  async sendActivationMail(to, code) {
    await this.transporter.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject: "Baskom",
      text: "",
      html: `
                    <div>
                        <h1>Активація аккаунту на Baskom</h1>
                        <h2>Ваш код для активації: <b> ${code}</b> </h2>
                    
                    </div>
                `,
    });
  }
}

module.exports = new MailService();
