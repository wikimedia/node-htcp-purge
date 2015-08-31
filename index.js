"use strict";

require('core-js/shim');

var P = require('bluebird');
var dgram = P.promisifyAll(require('dgram'));

/**
 * Creates a new cache purger instance
 *
 * @param options object containing options for a cache purger:
 *  - log:    logging function (default no-op)
 *  - routes: array of route objects to map a resource url to the cache endpoint
 *      - rule: ether regex for a resource url, or 'undefined' if it's a default endpoint
 *      - host: cache endpoint host
 *      - port: cache endpount port
 *  - multicast_ttl: standard UDP multicast TTL option (default 8)
 * @constructor
 */
function HTCPPurger(options) {
    var self = this;
    self.options = options || {};
    self.log = self.options.log || function() {};

    if (!self.options.routes) {
       throw new Error('Config error. At least one route must be specified');
    }

    self.options.routes.forEach(function(routeSpec) {
        if (routeSpec.rule && /^\/.+\/$/.test(routeSpec.rule)) {
            var regExp = new RegExp(routeSpec.rule.substring(1, routeSpec.rule.length - 1));
            routeSpec.rule = function(url) {
                return regExp.test(url);
            };
        } else {
            routeSpec.rule = function() { return true; };
        }
    });

    self.options.multicast_ttl = self.options.multicast_ttl || 8;

    self.seqReqId = 1;
}

/**
 * Construct a UDP datagram with HTCP packet for Varnish flush of the url
 * @param url a url of the resource that should be flushed
 * @returns {Buffer} resulting HTCP packet bytes
 * @private
 */
HTCPPurger.prototype._constructHTCPRequest = function(url) {
    var self = this;
    var urlByteLen = Buffer.byteLength(url);
    var htcpSpecifierLen = 2 + 4 + 2 + urlByteLen + 2 + 8 + 2;
    var htcpDataLen = 8 + 2 + htcpSpecifierLen;
    var htcpLen = 4 + htcpDataLen + 2;

    var result = new Buffer(htcpLen);
    // Length
    result.writeInt16BE(htcpLen, 0);
    // Major-minor version
    result.writeInt16BE(0, 2);
    // Data length
    result.writeInt16BE(htcpDataLen, 4);
    // Op code & response
    result.writeInt8(4, 6);
    // Reserved & flags
    result.writeInt8(0, 7);
    // Transaction Id - seq number of a a request
    result.writeInt32BE(self.seqReqId++, 8);

    // HTCP packet contents - CLR specifier
    // Reserved & reason
    result.writeInt16BE(0, 12);
    // COUNTSTR method: length + method (HEAD & GET are equivalent)
    result.writeInt16BE(4, 14);
    result.write('HEAD', 16, 4);
    // COUNTSTR uri: length + URI
    result.writeInt16BE(urlByteLen, 20);
    result.write(url, 22, urlByteLen);
    // COUNTSTR version: length + http version
    result.writeInt16BE(8, 22 + urlByteLen);
    result.write('HTTP/1.0', 24 + urlByteLen, 8);
    // COUNTSTR headers: empty, use just as padding
    result.writeInt16BE(0, 32 + urlByteLen);
    result.writeInt16BE(2, 14 + htcpSpecifierLen);

    return result;
};

/**
 * Lookup a cache endpoint for a concrete URL, based on options
 * supplied in constructor
 * @param url URL to lookup cache endpoint for
 * @returns {Object} an opbject with host and port keys
 * @private
 */
HTCPPurger.prototype._lookupRoute = function(url) {
    var self = this;
    var route = self.options.routes.find(function(route) {
        return route.rule(url);
    });
    if (!route) {
        self.log('error/htcp-purge', {
            msg: 'Could not find route for ' + url
        });
        return undefined;
    }
    return {
        host: route.host,
        port: route.port
    };
};

/**
 * Purge a list of resources cahced under provided URLs
 *
 * @param urls array of urls to purge
 */
HTCPPurger.prototype.purge = function(urls) {
    var self = this;
    var socket = dgram.createSocket('udp4');
    return socket.bindAsync()
    .then(function() {
        socket.setMulticastLoopback(false);
        socket.setMulticastTTL(self.options.multicast_ttl);
    })
    .then(function() {
        return P.all(urls.map(function(url) {
            var datagram = self._constructHTCPRequest(url);
            var route = self._lookupRoute(url);
            if (route) {
                return socket.sendAsync(datagram, 0, datagram.length, route.port, route.host);
            } else {
                return P.resolve();
            }
        }));
    })
    .then(function() {
        socket.close();
    });
};

module.exports = HTCPPurger;