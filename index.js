"use strict";

require('core-js/shim');

const P = require('bluebird');
const dgram = P.promisifyAll(require('dgram'));

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
class HTCPPurger {
    constructor(options) {
        this.options = options || {};
        this.log = this.options.log || (() => {});

        if (!this.options.routes) {
            throw new Error('Config error. At least one route must be specified');
        }

        this.options.routes.forEach((routeSpec) => {
            if (routeSpec.rule && /^\/.+\/$/.test(routeSpec.rule)) {
                const regExp = new RegExp(routeSpec.rule.substring(1, routeSpec.rule.length - 1));
                routeSpec.rule = (url) => regExp.test(url);
            } else {
                routeSpec.rule = () => true;
            }
        });

        this.options.multicast_ttl = this.options.multicast_ttl || 8;
        this.seqReqId = 1;
        this.socket = dgram.createSocket('udp4');
    }

    bind() {
        return this.socket.bindAsync({ exclusive: true })
        .then(() => {
            this.socket.setMulticastLoopback(false);
            this.socket.setMulticastTTL(this.options.multicast_ttl);
        });
    }


    /**
     * Purge a list of resources cahced under provided URLs
     *
     * @param urls array of urls to purge
     */
    purge(urls) {
        return P.all(urls.map((url) => {
            const datagram = this._constructHTCPRequest(url);
            const route = this._lookupRoute(url);
            if (route) {
                return this.socket.sendAsync(datagram, 0, datagram.length, route.port, route.host);
            } else {
                return P.resolve();
            }
        }));
    }

    close() {
        try {
            return this.socket.close();
        } catch (e) {
            // We've tried, but seems like socket is already closed, so swallow the error.
        }
    }
    /**
     * Construct a UDP datagram with HTCP packet for Varnish flush of the url
     * @param url a url of the resource that should be flushed
     * @returns {Buffer} resulting HTCP packet bytes
     * @private
     */
    _constructHTCPRequest(url) {
        const urlByteLen = Buffer.byteLength(url);
        const htcpSpecifierLen = 2 + 4 + 2 + urlByteLen + 2 + 8 + 2;
        const htcpDataLen = 8 + 2 + htcpSpecifierLen;
        const htcpLen = 4 + htcpDataLen + 2;

        const result = new Buffer(htcpLen);
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
        result.writeInt32BE(this.seqReqId++, 8);

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
    }

    /**
     * Lookup a cache endpoint for a concrete URL, based on options
     * supplied in constructor
     * @param url URL to lookup cache endpoint for
     * @returns {Object} an opbject with host and port keys
     * @private
     */
    _lookupRoute(url) {
        const route = this.options.routes.find((route) => route.rule(url));
        if (!route) {
            this.log('error/htcp-purge', {
                msg: `Could not find route for ${url}`
            });
            return undefined;
        }
        return {
            host: route.host,
            port: route.port
        };
    }
}

module.exports = HTCPPurger;
