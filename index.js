const dotenv = require('dotenv');
dotenv.config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');

// Load configuration
const configPath = path.join(__dirname, 'config.json');
const sentMessageIDsPath = path.join(__dirname, 'sentMessageIDs.json');
const postedMessagesPath = path.join(__dirname, 'postedMessages.json');

let config;
let WEEKDAY_MESSAGES = [];
let sentMessageIDs = new Set();
let postedMessageIDs = new Set();

try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    // Generate and sort messages with dates
    WEEKDAY_MESSAGES = generateAndSortMessagesWithDates();

    // Load sent message IDs from file
    if (fs.existsSync(sentMessageIDsPath)) {
        const data = JSON.parse(fs.readFileSync(sentMessageIDsPath, 'utf8'));
        sentMessageIDs = new Set(data);
    }

    // Load posted messages from file
    if (fs.existsSync(postedMessagesPath)) {
        const data = JSON.parse(fs.readFileSync(postedMessagesPath, 'utf8'));
        postedMessageIDs = new Set(data);
    }
} catch (error) {
    console.error('Error reading configuration files:', error);
    process.exit(1);
}

const YOUR_USER_ID = config.userID;
const CHANNEL_ID = config.channelID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ],
});

// Function to get the date of a specific weekday
function getDateOfWeekday(dayOffset) {
    const today = new Date();
    const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

    // Calculate the date for the target weekday
    const targetDay = (dayOffset + 1) % 7; // +1 to start from Monday as day 0
    const daysUntilTarget = (targetDay - currentDay + 7) % 7;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntilTarget);
    return targetDate; // Return the Date object
}

// Function to format date as "D.M" without year
function formatDateSimple(date) {
    const day = date.getDate();
    const month = date.getMonth() + 1; // Months are 0-indexed
    return `${day}.${month}`;
}

// Function to generate and sort messages with dates
function generateAndSortMessagesWithDates() {
    const weekDays = [
        "Maanantai", // Monday
        "Tiistai", // Tuesday
        "Keskiviikko", // Wednesday
        "Torstai", // Thursday
        "Perjantai", // Friday
        "Lauantai", // Saturday
        "Sunnuntai" // Sunday
    ];

    // Generate messages with dates
    const messagesWithDates = weekDays.map((day, index) => {
        const date = getDateOfWeekday(index);
        return {
            content: `${day} ${formatDateSimple(date)} 21:00`,
            date
        };
    });

    // Sort messages by date, closest to today first
    messagesWithDates.sort((a, b) => a.date - b.date);

    return messagesWithDates;
}

// Function to check if the current time is past 9 PM
function isPast9PM() {
    const now = new Date();
    return now.getHours() >= 21; // 21:00 is 9 PM
}

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Post messages for each weekday in the specified channel
    const channel = client.channels.cache.get(CHANNEL_ID);

    if (channel) {
        // If current time is past 9 PM, adjust the first message
        if (isPast9PM()) {
            const firstMessage = WEEKDAY_MESSAGES.shift(); // Remove the first message
            // Adjust the date by adding 7 days
            firstMessage.date.setDate(firstMessage.date.getDate() + 7);
            // Re-format the message with the new date
            firstMessage.content = `${firstMessage.content.split(' ')[0]} ${formatDateSimple(firstMessage.date)} 20:00`;
            // Add the adjusted message to the end of the list
            WEEKDAY_MESSAGES.push(firstMessage);
        }

        WEEKDAY_MESSAGES.forEach(async (message) => {
            const { content } = message;
            if (!postedMessageIDs.has(content)) {
                try {
                    const msg = await channel.send(content);
                    postedMessageIDs.add(msg.id); // Track the message ID
                    await msg.react('👍'); // Add an initial thumbs up reaction
                    await msg.react('👎'); // Add an initial thumbs down reaction

                    // Save the posted message IDs to the file
                    fs.writeFileSync(postedMessagesPath, JSON.stringify([...postedMessageIDs]));
                    console.log(`Posted and tracked message ID: ${msg.id}`);
                } catch (error) {
                    console.error('Error posting message:', error);
                }
            } else {
                console.log(`Message already posted: ${content}`);
            }
        });
    } else {
        console.error('Channel not found!');
    }
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    // Ensure the reaction is fully cached
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Error fetching reaction:', error);
            return;
        }
    }

    // Check for thumbs up reactions
    if (reaction.emoji.name === '👍' && reaction.count >= 2) {
        // Fetch the full message if it's not already cached
        if (reaction.message.partial) {
            try {
                await reaction.message.fetch();
            } catch (error) {
                console.error('Error fetching message:', error);
                return;
            }
        }

        const messageID = reaction.message.id;

        // Check if this message ID has already been sent privately
        if (!sentMessageIDs.has(messageID)) {
            try {
                const user = await client.users.fetch(YOUR_USER_ID); // Fetch the user object
                const dmMessage = await user.send(reaction.message.content); // Send the message content
                
                // Add check mark reaction to the DM message
                await dmMessage.react('✅');
                
                console.log('Sent DM with message content and added check mark reaction.');

                // Add message ID to sent messages set and save to file
                sentMessageIDs.add(messageID);
                fs.writeFileSync(sentMessageIDsPath, JSON.stringify([...sentMessageIDs]));
            } catch (error) {
                console.error('Error sending DM or adding reaction:', error);
            }
        } else {
            console.log('Message ID already sent in DM.');
        }
    }

    // Check for check mark reactions
    if (reaction.emoji.name === '✅') {
        // Fetch the full message if it's not already cached
        if (reaction.message.partial) {
            try {
                await reaction.message.fetch();
            } catch (error) {
                console.error('Error fetching message:', error);
                return;
            }
        }

        // Send the message content to the channel if the reaction was added to a message sent by the bot
        if (reaction.message.author.id === client.user.id) {
            try {
                const channel = client.channels.cache.get(CHANNEL_ID);
                if (channel) {
                    await channel.send(`Scrimit bookattu ajalle ${reaction.message.content} @here`);
                    console.log('Sent message content to channel.');
                } else {
                    console.error('Channel not found!');
                }
            } catch (error) {
                console.error('Error sending message content to channel:', error);
            }
        }
    }

    // Check for thumbs down reactions
    if (reaction.emoji.name === '👎' && reaction.count >= 2) {
        // Fetch the full message if it's not already cached
        if (reaction.message.partial) {
            try {
                await reaction.message.fetch();
            } catch (error) {
                console.error('Error fetching message:', error);
                return;
            }
        }

        // Delete the message
        try {
            await reaction.message.delete();
            console.log('Message deleted due to thumbs down reactions.');
            // Remove the deleted message ID from the set
            postedMessageIDs.delete(reaction.message.id);
            // Save the updated message IDs to the file
            fs.writeFileSync(postedMessagesPath, JSON.stringify([...postedMessageIDs]));
            console.log(`Updated posted messages after deletion. ID removed: ${reaction.message.id}`);
        } catch (error) {
            console.error('Error deleting message:', error);
        }
    }
});

// Handle private messages
client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // Ignore bot messages

    if (message.channel.type === ChannelType.DM || message.channel.type === ChannelType.GuildText) {
        console.log(`Received DM: ${message.content}`);

        if (message.content.trim().toLowerCase() === 'clear') {
            console.log('Clear command detected.');

            try {
                // Delete all previous messages from the bot in the DM channel
                const messages = await message.channel.messages.fetch();
                const botMessages = messages.filter(msg => msg.author.id === client.user.id);
                await Promise.all(botMessages.map(msg => msg.delete()));

                console.log('Cleared all previous messages in DM channel.');
            } catch (error) {
                console.error('Error clearing DM messages:', error);
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
