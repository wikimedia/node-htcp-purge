"use strict";

const HTCPPurger = require('../index.js');

function validateArgs() {
    if (process.argv.length !== 4) {
        return false;
    }
    const varnishIP = process.argv[2];
    return /(?:\d{1,3}\.){3}\d{1,3}:\d{4}/.test(varnishIP);

}
if (!validateArgs()) {
    console.log('Usage: node purge.js <varnish ip:port> <resource uri>');
    process.exit(1);
}

const varnishIP = process.argv[2];
const purgeURL = process.argv[3];
const hostPortMatch = varnishIP.match(/((?:\d{1,3}\.){3}\d{1,3}):(\d{4})/);
const varnishHostIp = hostPortMatch[1];
const varnishPort = parseInt(hostPortMatch[2]);

const purger = new HTCPPurger({
    log: console.log.bind(console),
    routes: [{
            host: varnishHostIp,
            port: varnishPort
        }]
});

console.log(`Sending a datagram to ${varnishHostIp}:${varnishPort} for uri ${purgeURL}`);
purger.bind().then(() => purger.purge([purgeURL])).delay(100).then(() => purger.close());

