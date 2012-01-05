var dgram  = require('dgram')
  , sys    = require('sys')
  , net    = require('net')
  , config = require('./config')
	, mongo = require('mongodb')
	, Server = mongo.Server
	, Db = mongo.Db;

/* {strict:false} allows us to call db.collection(name) and if name is not a collection, it creates it, else returns it */
var db_conn = new Db('DailyActivity', new Server('localhost', '27017', {auto_reconnect:true}), {native_parser:false}, {strict:false});	
/* date helper  */
Date.prototype.yyyymmdd = function() {
  var yyyy = this.getFullYear().toString();
   var mm = (this.getMonth()+1).toString(); // getMonth() is zero-based
   var dd  = this.getDate().toString();
   return yyyy + (mm[1]?mm:"0"+mm[0]) + (dd[1]?dd:"0"+dd[0]); // padding
};

var counters = {};
var timers = {};
var debugInt, flushInt, server, mgmtServer;
var startup_time = Math.round(new Date().getTime() / 1000);

var stats = {
  graphite: {
    last_flush: startup_time,
    last_exception: startup_time
  },
  messages: {
    last_msg_seen: startup_time,
    bad_lines_seen: 0
  }
};

config.configFile(process.argv[2], function (config, oldConfig) {
  if (! config.debug && debugInt) {
    clearInterval(debugInt); 
    debugInt = false;
  }

  if (config.debug) {
    if (debugInt !== undefined) { clearInterval(debugInt); }
    debugInt = setInterval(function () { 
      sys.log("Counters:\n" + sys.inspect(counters) + "\nTimers:\n" + sys.inspect(timers));
    }, config.debugInterval || 10000);
  }

  if (server === undefined) {
		db_conn.open(function(e, db_client){
	    server = dgram.createSocket('udp4', function (msg, rinfo) {
	      if (config.dumpMessages) { sys.log(msg.toString()); }
	      var bits = msg.toString().split(':');  			// ex: "gorets:1|c|@0.1"
        
				/***********************************************************************/
				/*	checking if a UID was passed into namespace via a '/?'						 */
				/*	e.g. stats.app.metric/?uid=UID&action=ACTION											 */
				/***********************************************************************/
				split_bits = bits[0].split('/?');
				bits[0] = split_bits[0];
				var uid = null, action = null, params = null;
				if (split_bits[1]) {
					params =  split_bits[1].split("&");
					for (p in params) {
						var param_split = params[p].split("=");
						switch (param_split[0]){
							case "uid":
								uid = param_split[1];
								break;
							case "action":
								action = param_split[1];
								break;
						}
					}
				}
				/***********************************************************************/
				
        var key = bits.shift() 																					// ex:gorets
	                    .replace(/\s+/g, '_')
	                    .replace(/\//g, '-')
	                    .replace(/[^a-zA-Z_\-0-9\.]/g, '');

	      if (bits.length == 0) {
	        bits.push("1");
	      }

	      for (var i = 0; i < bits.length; i++) {
	        var sampleRate = 1;
	        var fields = bits[i].split("|"); 															// ex: ["1", "c", "@0.1"]
	        if (fields[1] === undefined) {																// must have a "c" or "ms"
	            sys.log('Bad line: ' + fields);
	            stats['messages']['bad_lines_seen']++;
	            continue;
	        }
	        if (fields[1].trim() == "ms") {																// then its a timer
	          if (! timers[key]) {																				// initializing a timer if doesnt exist yet
	            timers[key] = [];
	          }
	          timers[key].push(Number(fields[0] || 0));										// store the timer
	        } else {																											// then its a counter
	          if (fields[2] && fields[2].match(/^@([\d\.]+)/)) {
	            sampleRate = Number(fields[2].match(/^@([\d\.]+)/)[1]);		// change the sampleing rate
	          }
	          if (! counters[key]) {
	            counters[key] = 0;																				// initializing a counter if doesnt exist yet
	          }
						
						/***********************************************************************/
						/* This is where we check if a UID existed in the namespace and if so	 */
						/* store it in mongo appropriatly																			 */
						/***********************************************************************/
						if (uid && action){
							var d = new Date;
							var collection_name = 'Daily:' + d.yyyymmdd();
							db_client.createCollection(collection_name, function(err,collection){
								if (err){ console.log("[STATSD] ERROR: error creating or finding collection"); }
								/* create doc to insert/update */
								var doc = {}; doc[action] = 1;
								/* insert or update the relevant element of the document */
								collection.update( {_id: new ObjectID(uid)}, {$inc: doc}, {upsert: true} );
							});
						}
						/***********************************************************************/
												
	          counters[key] += Number(fields[0] || 1) * (1 / sampleRate); // store the counter
	        }
	      }

	      stats['messages']['last_msg_seen'] = Math.round(new Date().getTime() / 1000);
	    });

	    mgmtServer = net.createServer(function(stream) {
	      stream.setEncoding('ascii');

	      stream.on('data', function(data) {
	        var cmd = data.trim();

	        switch(cmd) {
	          case "help":
	            stream.write("Commands: stats, counters, timers, quit\n\n");
	            break;

	          case "stats":
	            var now    = Math.round(new Date().getTime() / 1000);
	            var uptime = now - startup_time;

	            stream.write("uptime: " + uptime + "\n");

	            for (group in stats) {
	              for (metric in stats[group]) {
	                var val;

	                if (metric.match("^last_")) {
	                  val = now - stats[group][metric];
	                }
	                else {
	                  val = stats[group][metric];
	                }

	                stream.write(group + "." + metric + ": " + val + "\n");
	              }
	            }
	            stream.write("END\n\n");
	            break;

	          case "counters":
	            stream.write(sys.inspect(counters) + "\n");
	            stream.write("END\n\n");
	            break;

	          case "timers":
	            stream.write(sys.inspect(timers) + "\n");
	            stream.write("END\n\n");
	            break;

	          case "quit":
	            stream.end();
	            break;

	          default:
	            stream.write("ERROR\n");
	            break;
	        }

	      });
	    });

	    server.bind(config.port || 8125);
	    mgmtServer.listen(config.mgmt_port || 8126);

	    var flushInterval = Number(config.flushInterval || 10000);

	    flushInt = setInterval(function () {
	      var statString = '';
	      var ts = Math.round(new Date().getTime() / 1000);
	      var numStats = 0;
	      var key;

	      for (key in counters) {																											// This is where counters formatted for Graphite
	        var value = counters[key] / (flushInterval / 10000);
	        var message = 'stats.' + key + ' ' + value + ' ' + ts + "\n";
	        message += 'stats_counts.' + key + ' ' + counters[key] + ' ' + ts + "\n";
	        statString += message;
	        counters[key] = 0;

	        numStats += 1;
	      }

	      for (key in timers) {
	        if (timers[key].length > 0) {
	          var pctThreshold = config.percentThreshold || 90;
	          var values = timers[key].sort(function (a,b) { return a-b; });
	          var count = values.length;
	          var min = values[0];
	          var max = values[count - 1];

	          var mean = min;
	          var maxAtThreshold = max;

	          if (count > 1) {
	            var thresholdIndex = Math.round(((100 - pctThreshold) / 100) * count);
	            var numInThreshold = count - thresholdIndex;
	            values = values.slice(0, numInThreshold);
	            maxAtThreshold = values[numInThreshold - 1];

	            // average the remaining timings
	            var sum = 0;
	            for (var i = 0; i < numInThreshold; i++) {
	              sum += values[i];
	            }

	            mean = sum / numInThreshold;
	          }

	          timers[key] = [];

	          var message = "";
	          message += 'stats.timers.' + key + '.mean ' + mean + ' ' + ts + "\n";
	          message += 'stats.timers.' + key + '.upper ' + max + ' ' + ts + "\n";
	          message += 'stats.timers.' + key + '.upper_' + pctThreshold + ' ' + maxAtThreshold + ' ' + ts + "\n";
	          message += 'stats.timers.' + key + '.lower ' + min + ' ' + ts + "\n";
	          message += 'stats.timers.' + key + '.count ' + count + ' ' + ts + "\n";
	          statString += message;

	          numStats += 1;
	        }
	      }

	      statString += 'statsd.numStats ' + numStats + ' ' + ts + "\n";
      
	      try {																																						// This is where everything starts to get written to Graphite
	        var graphite = net.createConnection(config.graphitePort, config.graphiteHost);
	        graphite.addListener('error', function(connectionException){
	          if (config.debug) {
	            sys.log(connectionException);
	          }
	        });
	        graphite.on('connect', function() {
	          this.write(statString);																											// actually writing to Graphite
	          this.end();
	          stats['graphite']['last_flush'] = Math.round(new Date().getTime() / 1000);
	        });
	      } catch(e){
	        if (config.debug) {
	          sys.log(e);
	        }
	        stats['graphite']['last_exception'] = Math.round(new Date().getTime() / 1000);
	      }

	    }, flushInterval);
  
		});
	}

});