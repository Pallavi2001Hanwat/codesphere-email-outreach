export function message({ brand, observation, suggestion }) {
    const sender = process.env.SENDER_NAME?.trim() || 'Pallavi';

    return {
        subject: `An idea for ${brand}’s Shopify store`,
        text: [
            `Hi ${brand} team,`,
            `${observation} ${suggestion}`,
            `I’m ${sender} from CodeSphere Innovations. Would you like me to send a quick mockup of the change?`,
            `Best,\n${sender}\nCodeSphere Innovations`,
            'If you’d prefer no further emails, reply STOP.'
        ].join('\n\n')
    };
}
