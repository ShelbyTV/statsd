/*

Required Variables:

  graphiteHost:     hostname or IP of Graphite server
  graphitePort:     port of Graphite server
  port:             StatsD listening port [default: 8125]
  mongo_host:       Mongo host 
  mongo_port:       Mongo port 

Optional Variables:

  debug:            debug flag [default: false]
  debugInterval:    interval to print debug information [ms, default: 10000]
  dumpMessages:     log all incoming messages
  flushInterval:    interval (in ms) to flush to Graphite
  percentThreshold: for time information, calculate the Nth percentile
                    [%, default: 90]

*/
{
  graphitePort: 2003
, graphiteHost: "33.33.33.10"
, port: 8125
, mongo_host: 'localhost'
, mongo_port: '27017'
}
