/**
 * The job to query tags of Utopian.io blogs
 * @see     https://steemit.com/utopian-io/@crokkon/using-the-utopian-api-interface-for-bot-analysis-bisteemit
 * @author  MarcoXZh3
 * @version 1.0.0
 */
const fs = require('fs');
const MongoClient = require('mongodb').MongoClient;
const request = require("request");
const sort = require('alphanum-sort');
const steem = require('steem');

/**
 * Entry function -- load options from setting
 * @param {json}        parentOptions   options from the parent method
 * @param {function}    callback        (optional) the callback function
 */
module.exports = function(parentOptions, callback) {
    fs.readFile(__filename.replace(/\.js$/g, '.json'),
                { encoding:'utf8', flag:'r'}, function(err, data) {
        if (err) {
            throw err;
        } // if (err)
        var options = JSON.parse(data.toString());
        for (k in parentOptions) {
            options[k] = parentOptions[k];
        } // for (k in parentOptions)
        runJob(options, callback);
    }); // fs.readFile( ... );
}; // module.exports = function(parentOptions, callback) { ... };


/**
 * Run the query cn tags job
 * @param {json}        options     settings for the job
 * @param {function}    callback    (optional) the callback function
 */
var runJob = function(options, callback) {
    var today = new Date(new Date().getTime() - 86400000 * options.days_before);
    today.setUTCHours(0, 0, 0, 0);
    var yesterday = new Date(today.getTime() - 86400000);
    console.log('QueryUtopianTags: retrieving - from ' + yesterday.toISOString()
                                            + ' to ' + today.toISOString());
    options.today = today;
    options.yesterday = yesterday;
    getTodayBlogs(options, 0, [], callback);
}; // var runJob = function(options, callback) { ... };


/**
 * Get all today's blogs
 * @param {json}        options     settings for the job
 * @param {integer}     skip        number of blogs to be skipped
 * @param {array}       blogs       the list of today's blogs
 * @param {function}    callback    (optional) the callback function
 */
var getTodayBlogs = function(options, skip, blogs, callback) {
    request({ uri:'https://api.utopian.io/api/posts/?sortBy=created&limit=100&skip=' + skip,
              gzip:true }, function (err, res, body) {
        if (err || res.statusCode !== 200) {
            throw err || new Error('Unsupported status code: ' + res.statusCode);
        } // if (err || res.statusCode !== 200)

        // Get this chunk
        var oldest = new Date().getTime();
        var res = JSON.parse(body);
        var chunk = res.results.map(function(b) {
            var created = new Date(b.created + 'Z').getTime();
            oldest = created < oldest ? created : oldest;
            return (created >= options.yesterday.getTime() &&
                    created < options.today.getTime()) ? b : null;
        }).filter( (e)=>e ); // var chunk = res.results.map( ... ).filter( ... );
        blogs = blogs.concat(chunk);

        // Go next
        if (oldest >= options.yesterday.getTime()) {
            getTodayBlogs(options, skip + res.results.length, blogs, callback);
        } else {
            // Log the result
            console.log('QueryUtopianTags: found - chunk=' + skip + '; blogs=' +
                        blogs.length);
            if (blogs.length > 0) {
                analyzeData(options, blogs, callback);
            } else {
                log(options, { count:0 });
            } // else - if (blogs.length > 0)
        } // else - if (oldest < options.yesterday.getTime())
    }); // request( ... );
}; // var getTodayBlogs = function(options, skip, blogs, callback) { ... };


/**
 * Analyze the data
 * @param {json}        options     settings for the job
 * @param {array}       records     blogs to be analyzed
 * @param {function}    callback    (optional) the callback function
 */
var analyzeData = function(options, records, callback) {
    var results = { count:records.length, blogs:[], types:{} };

    // Anaylze blog payouts (array.sort returns wrong result)
    var map = {};
    records.forEach(function(e) {
        var k = '';
        while ((e.total_payout_value + k) in map) {
            k = (k === '') ? 2 : (k + 1);
        } // while ((e.total_payout_value + k) in map)
        map[e.total_payout_value + k] = e;
    }); // records.forEach(function(e) { ... });
    results.blogs = sort(Object.keys(map)).slice(records.length - options.count)
                                          .map(function(e) {
        return map[e];
    }); // results.blogs = sort(Object.keys(map)).slice( ... ).map( ... );

    // Analyze types
    records.forEach(function(b) {
        var k = b.json_metadata.type;
        var pay = parseFloat(b.total_payout_value.split(' ')[0]);
        if (k in results.types) {
            results.types[k].freq ++;
            results.types[k].pay_total += pay;
        } else {
            results.types[k] = { freq:1, pay_total:pay };
        } // else - if (k in results.types)
    }); // records.forEach(function(b) { ... });
    Object.keys(results.types).forEach(function(k) {
        var v = results.types[k];
        v.pay_avg = v.pay_total / v.freq;
    }); // Object.keys(results.types).forEach(function(k) { ... });

    // Go next
    statistics(options, results, callback);
}; // var analyzeData = function(options, records, callback) { ... };


/**
 * do some statistics
 * @param {json}        options     settings for the job
 * @param {json}        results     the result in json object
 * @param {function}    callback    (optional) the callback function
 */
var statistics = function(options, results, callback) {
    var types  = results.types;
    var keys = Object.keys(types);
    console.log('QueryUtopianTags: found - types=' + keys.length);

    var stats = { count:results.count, blogs:results.blogs };
    // Frequency of each type sorted
    stats.type_freq = sort(keys.map( (k)=>types[k].freq+'/'+k ))
                            .map((e)=>e.split('/') );
    // Total payouts by type, sorted
    stats.type_pay_total = sort(keys.map( (k)=>types[k].pay_total+'/'+k ))
                                .map((e)=>e.split('/') );
    // Payouts per blog by type, sorted
    stats.type_pay_avg = sort(keys.map( (k)=>(10000*types[k].pay_total/types[k].freq)+'/'+k ))
                                .map((e)=>e.split('/') );
    // Blogs sorted by payout
    stats.type_pay_blog = results.blogs.map(function(e) {
        return { 
            payout: parseFloat(e.total_payout_value.split(' ')[0]),
            type:   e.type,
            author: e.author,
            title:  e.title
        }; // return { ... };
    }); // stats.type_pay_blog = results.blogs.map(function(e) { ... });
    // stats.type_pay_blog.reverse();

    // Go next
    prepareBlog(options, stats, callback);
}; // var statistics = function(options, result, callback) { ... };


/**
 * Prepare writing the blog
 * @param {json}        options     settings for the job
 * @param {json}        stats       the statistics in json object
 * @param {function}    callback    (optional) the callback function
 */
var prepareBlog = function(options, stats, callback) {
    if (stats.type_freq.length % 2) {
        Object.keys(stats).forEach(function(k) {
            if (k === 'count' || k === 'blogs') {
                return ;
            } // if (k === 'count' || k === 'blogs')
            stats[k].unshift(['', '']);
        }); // Object.keys(stats).forEach(function(k) { ... });
    } // if (stats.type_freq.length % 2)

    var total = stats.type_freq.length;
    var half = Math.ceil(0.5 * total);
    var precision = Math.round(1.0 / options.decimal);
    fs.readFile(__filename.replace(/\.js$/g, options.body_ext),
                { encoding:'utf8', flag:'r'}, function(err, data) {
        if (err) {
            throw err;
        } // if (err)
        var body = {
            type_freq:      [],
            type_pay_total: [],
            type_pay_avg:   []
        }; // var body = { ... };

        // Format the rows for the type tables
        Object.keys(body).forEach(function(k) {
            stats[k].reverse();
            stats[k].forEach(function(e, i) {
                // Index - centered
                var idx = (i + 1) + '';
                while (idx.length < options.fmt_width_idx) {
                    idx = ' ' + idx + ' '
                } // while (idx.length < options.fmt_width_idx)
                if (idx.length > options.fmt_width_idx) {
                    idx = idx.substr(1);
                } // if (idx.length > options.fmt_width_idx)
                // Type value - centered
                if (k.includes('pay') && e[0] !== '') {
                    e[0] = parseFloat(e[0]);
                    if (k.includes('pay_avg')) {
                        e[0] /= 10000.0;
                    } // if (k.includes('pay_avg'))
                    e[0] = '$' + (Math.round(e[0] * precision) / precision);
                } // if (k.includes('pay') && e[0] !== '')
                while (e[0].length < options.fmt_width_cnt) {
                    e[0] = ' ' + e[0] + ' '
                } // while (e[0].length < options.fmt_width_cnt)
                if (e[0].length > options.fmt_width_cnt) {
                    e[0] = e[0].substr(1);
                } // if (e[0].length > options.fmt_width_cnt)
                // Type name - left aligned
                e[1] = ' ' + e[1];
                while (e[1].length < options.fmt_width_name) {
                    e[1] += ' ';
                } // while (e[1].length < options.fmt_width_name)
                if (i < half) {
                    body[k].push('   |' + idx + '|' + e[0] + '|' + e[1] + '|');
                } else {
                    body[k][i-half] += idx + '|' + e[0] + '|' + e[1] + '|';
                } // else - if (i < half)
            }); // stats[k].forEach(function(e, i) { ... });
        }); // Object.keys(body).forEach(function(k) { ... });

        // Format the rows for the blog table
        body.type_pay_blog = [];
        body.type_url_blog = [];
        stats.blogs.reverse();
        stats.blogs.forEach(function(b, i) {
            // Index - centered
            var idx = (i + 1) + '';
            while (idx.length < options.fmt_width_idx) {
                idx = ' ' + idx + ' '
            } // while (idx.length < options.fmt_width_idx)
            if (idx.length > options.fmt_width_idx) {
                idx = idx.substr(1);
            } // if (idx.length > options.fmt_width_idx)
            // Payout - centered
            var pay = parseFloat(b.total_payout_value.split(' ')[0]);
            pay = '$' + (Math.round(pay * precision) / precision);
            while (pay.length < options.fmt_width_cnt) {
                pay = ' ' + pay + ' '
            } // while (pay.length < options.fmt_width_cnt)
            if (pay.length > options.fmt_width_cnt) {
                pay = pay.substr(1);
            } // if (pay.length > options.fmt_width_cnt)
            // Type name - left aligned
            while (b.json_metadata.type.length < options.fmt_width_type) {
                b.json_metadata.type += ' ';
            } // while (b.json_metadata.type.length < options.fmt_width_type)
            // Author - left aligned
            while (b.author.length < options.fmt_width_author) {
                b.author += ' ';
            } // while (b.author.length < options.fmt_width_author)
            // Title - left aligned
            b.title = b.title.replace(/\|/g, '&#124;');
            while (b.title.length < options.fmt_width_title) {
                b.title += ' ';
            } // while (b.title.length < options.fmt_width_title)
            body.type_pay_blog.push('   |' + idx + '|' + pay + '|' +
                                    b.json_metadata.type + '|' + b.author +
                                    '|[' + b.title + '][' + idx.trim() + ']|');
            body.type_url_blog.push('[' + idx.trim() + ']: https://steemit.com'
                                        + b.url);
        }); // stats.blogs.forEach(function(b, i) { ... });

        // Other fields
        var strNow = new Date().toISOString();
        body.today = options.today;
        body.yesterday = options.yesterday;
        body.title = options.title + strNow.split('T')[0];
        body.author = options.author.name;
        body.json_metadata = options.json_metadata;

        // Go publish it
        publishBlog(options, {
            title:          body.title,
            author:         body.author,
            json_metadata:  body.json_metadata,
            body:   data.toString()
                        .replace('$YESTERDAY',  options.yesterday.toISOString())
                        .replace('$TODAY',      options.today.toISOString())
                        .replace('$NOW',        strNow)
                        .replace('$COUNT',      stats.count)
                        .replace('$LIMIT',      options.count)
                        .replace('$type_freq',   body.type_freq.join('\n'))
                        .replace('$type_pay_total', body.type_pay_total.join('\n'))
                        .replace('$type_pay_avg',   body.type_pay_avg.join('\n'))
                        .replace('$type_pay_blog',  body.type_pay_blog.join('\n'))
                        .replace('$type_url_blog',  body.type_url_blog.join('\n'))
        }, callback);

        // Log the body
        log(options, body);
    }); // fs.readFile( ... );
}; // var prepareBlog = function(options, stats, callback) { ... };


/**
 * Publish the blog
 * @param {json}        options     settings for the job
 * @param {json}        blog        the blog in json object
 * @param {function}    callback    (optional) the callback function
 */
var publishBlog = function(options, blog, callback) {
    steem.broadcast.comment(options.author.posting, '', 'cn', options.author.name,
                            permlink, blog.title, blog.body, blog.json_metadata,
                            function(err, re) {
        if (err) {
            throw err
        } // if (err)
        console.log('QueryUtopianTags: published - ' + new Date().toISOString());
        if (callback) {
            callback(blog);
        } // if (callback)
    }); // steem.broadcast.comment( ... );
}; // var publishBlog = function(options, blog, callback) { ... };


/**
 * Log the message
 * @param {json}    options     settings for the job
 * @param {json}    body        the message body
 */
var log = function(options, body) {
    MongoClient.connect(options.db.uri, function(err, client) {
        if (err) {
            console.error(err);
            return ;
        } // if (err)
        client.db(options.db.name)
              .collection(options.db_collection)
              .insertOne(body, function(err, res) {
            if (err) {
                console.error(err);
            } // if (err)
        }); // client.db( ... ).collection( ... ).insert( ... );
    }); // MongoClient.connect(options.db.uri, function(err, client) { ... });
}; // var log = function(options, body) { ... };
