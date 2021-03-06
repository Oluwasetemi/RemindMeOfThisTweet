"use strict";

const {
    randomReminderMessage,
    randomAcknowledgementMessage,
    TwitterErrorResponse
} = require('./utils');

const Twit = require('twit');

const t = new Twit({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token: process.env.TWITTER_ACCESS_TOKEN,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});

module.exports = (cache) => {

    const getMentions = async (lastTweetRetrieved) => {
        let lastTweetId = lastTweetRetrieved || await cache.getAsync('lastTweetRetrieved');
        let options = {count: 200, tweet_mode: "extended"};
        if (lastTweetId) {
            options.since_id = lastTweetId;
        }
        return t.get('statuses/mentions_timeline', options)
            .then(r => r.data)
            .catch(e => {
                throw new TwitterErrorResponse('statuses/mentions_timeline', e);
            })
            .then(tweets => tweets.map(tweetObject => {
                return {
                    id: tweetObject.id_str,
                    created_at: tweetObject.created_at,
                    text: tweetObject.full_text,
                    referencing_tweet: tweetObject.in_reply_to_status_id_str,
                    author: tweetObject.user.screen_name,
                    utcOffset: parseInt(tweetObject.user.utc_offset)
                }
            }));
    };

    const reply = async (tweet, content) => {
        let options = {
            in_reply_to_status_id: tweet.id,
            status: `@${tweet.author} ${content}`
        };
        return t.post('statuses/update', options)
            .then((r) => r.data)
            .catch(e => {
                if ((e.valueOf() + '').includes('User is over daily status update limit')) {
                    // not sending any more replies for 10 minutes
                    // to avoid Twitter blocking our API access
                    console.log('Rate limit reached, backing off for 10 minutes');
                    return cache.setAsync('no-reply', 1, 'EX', 10 * 60);
                }

                throw new TwitterErrorResponse('statuses/update', e);
            });
    };

    const replyWithReminder = async (tweet) => {
        let noReply = await cache.getAsync('no-reply');
        if (noReply == 1) {
            return true;
        }

        let content = randomReminderMessage(tweet.author);
        return reply(tweet, content);
    };

    const replyWithAcknowledgement = async (tweet, date) => {
        let noReply = await cache.getAsync('no-reply');
        if (noReply == 1) {
            return true;
        }

        let content = randomAcknowledgementMessage(date, tweet.author);
        return reply(tweet, content);
    };

    const fetchAllMentions = async () => {
        let lastTweetRetrieved = null;
        let count = 0;
        let mentions = await getMentions();
        let allMentions = [...mentions];
        while (mentions.length) {
            lastTweetRetrieved = mentions[0].id;
            count += mentions.length;
            mentions = await getMentions(lastTweetRetrieved);
            allMentions.concat(mentions);
        }

        if (lastTweetRetrieved) {
            await cache.setAsync('lastTweetRetrieved', lastTweetRetrieved);
        }
        return allMentions;
    };

    return {
        replyWithReminder,
        replyWithAcknowledgement,
        fetchAllMentions
    };

};
