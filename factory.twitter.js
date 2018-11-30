"use strict";

const {
    randomSuccessResponse,
    TwitterErrorResponse
} = require('./utils');

const Twit = require('twit');

const t = new Twit({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token: process.env.TWITTER_ACCESS_TOKEN,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});

const isTweetAReply = (tweet) => !!tweet.in_reply_to_status_id_str;

module.exports = (cache) => {

    const getMentions = async (lastTweetRetrieved) => {
        let lastTweetId = lastTweetRetrieved || await cache.getAsync('lastTweetRetrieved');
        let options = {count: 200};
        if (lastTweetId) {
            options.since_id = lastTweetId;
        }
        return t.get('statuses/mentions_timeline', options)
            .then(r => {
                if (r.data.errors) {
                    throw `Error in statuses/mentions_timeline response: ${JSON.stringify(r.data.errors)}`;
                }
                return r.data;
            })
            .then(tweets => tweets.filter(isTweetAReply))
            .then(tweets => tweets.map(tweetObject => {
                return {
                    id: tweetObject.id_str,
                    time: tweetObject.created_at,
                    text: tweetObject.text,
                    referencing_tweet: tweetObject.in_reply_to_status_id_str,
                    author: tweetObject.user.screen_name
                }
            }));
    };

    const getActualTweetsReferenced = (tweets) => {
        return t.post(`statuses/lookup`, {
            id: pluck(tweets, 'referencing_tweet'),
            tweet_mode: 'extended',
        }).then(r => {
            if (r.data.errors) {
                throw new TwitterErrorResponse('statuses/lookup', r.data.errors);
            }
            return r.data;
        });
    };

    const reply = async (tweet, content) => {
        let options = {
            in_reply_to_status_id: tweet.id,
            status: `@${tweet.author} ${content}`
        };
        return t.post('statuses/update', options)
            .then((r) => {
                if (r.data.errors) {
                    // not sending any more replies for 10 minutes to avoid Twitter blocking our API access
                    return cache.setAsync('no-reply', 1, 'EX', 10 * 60).then(() => r);
                }
                return r;
            });
    };

    const replyWithReminder = async (tweet) => {
        let noReply = await cache.getAsync('no-reply');
        if (noReply == 1) {
            return true;
        }

        let content = randomSuccessResponse(tweet.author);
        return reply(tweet, content);
    };

    const fetchTweet = (tweetId) => {
        return t.get(`statuses/show`, {
            id: tweetId,
            tweet_mode: 'extended',
        }).then(r => {
            if (r.data.errors) {
                throw new TwitterErrorResponse('statuses/show', r.data.errors);
            }
            return r.data;
        });
    };

    return {
        getMentions,
        reply,
        replyWithReminder,
        getActualTweetsReferenced,
        fetchTweet
    };

};
