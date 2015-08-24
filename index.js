"use strict";

require('core-js/shim');

var P = require('bluebird');
var dgram = P.promisifyAll(require('dgram'));
var jsPack = require('jspack').jspack;

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
    var htcpSpecifier = jsPack.Pack('!H4sH' + url.length + 'sH8sH',
        [4, 'HEAD', url.length, url, 8, 'HTTP/1.0', 0]);
    var htcpDataLen = 8 + 2 + htcpSpecifier.length;
    var htcpLen = 4 + htcpDataLen + 2;
    var result = jsPack.Pack('!HxxHBxLxx' + htcpSpecifier.length + 'AH',
        [htcpLen, htcpDataLen, 4, self.seqReqId++, htcpSpecifier, 2]);
    return new Buffer(result);
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