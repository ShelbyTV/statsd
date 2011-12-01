/*

Required Variables:

  graphiteHost:     hostname or IP of Graphite server
  graphitePort:     port of Graphite server
  port:             StatsD listening port [default: 8125]
  redis_host:       Redis host [default: localhost]
  redis_port:       Redis port [default: 6137]

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
, redis_host: 'localhost'
, redis_port: '6137'
}
