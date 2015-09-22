"use strict";

var HTCPPurger = require('../index.js');

function validateArgs() {
    if (process.argv.length !== 4) {
        return false;
    }
    var varnishIP = process.argv[2];
    return /(?:\d{1,3}\.){3}\d{1,3}:\d{4}/.test(varnishIP);

}
if (!validateArgs()) {
    console.log('Usage: node purge.js <varnish ip:port> <resource uri>');
    process.exit(1);
}

var varnishIP = process.argv[2];
var purgeURL = process.argv[3];
var hostPortMatch = varnishIP.match(/((?:\d{1,3}\.){3}\d{1,3}):(\d{4})/);
var varnishHostIp = hostPortMatch[1];
var varnishPort = parseInt(hostPortMatch[2]);

var purger = new HTCPPurger({
    log: console.log.bind(console),
    routes: [{
            host: varnishHostIp,
            port: varnishPort
        }]
});

console.log('Sending a datagram to ' + varnishHostIp + ':' + varnishPort + ' for uri ' + purgeURL);
purger.purge([purgeURL]);

