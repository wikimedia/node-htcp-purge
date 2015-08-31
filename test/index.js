"use strict";

require('mocha-jshint')();

var HTCPPurger = require('../index');
var assert = require('assert');
var dgram = require('dgram');

describe('Protocol tests', function() {
    var referenceBuffer = new Buffer([0, 44, 0, 0, 0, 38, 4, 0,
        0, 0, 0, 1, 0, 0, 0, 4, 72, 69, 65, 68, 0, 8,
        116, 101, 115, 116, 46, 99, 111, 109, 0, 8, 72,
        84, 84, 80, 47, 49, 46, 48, 0, 0, 0, 2]);
    var referenceBuffer2 = new Buffer([0, 44, 0, 0, 0, 38, 4, 0,
        0, 0, 0, 2, 0, 0, 0, 4, 72, 69, 65, 68, 0, 8,
        116, 101, 115, 116, 46, 99, 111, 109, 0, 8, 72,
        84, 84, 80, 47, 49, 46, 48, 0, 0, 0, 2]);

    it('should construct correct datagram', function() {
        var purger = new HTCPPurger({
            routes: [
                {
                    host: 'default',
                    port: 4827
                }
            ]
        });
        var resultDatagram = purger._constructHTCPRequest('test.com');
        assert.deepEqual(referenceBuffer, resultDatagram);
    });

    it ('should lookup route by regex', function() {
        var purger = new HTCPPurger({
            routes: [
                {
                    rule: '/https?:\\/\\/test\\.com/',
                    host: '123.123.123.123',
                    port: 1234
                },
                {
                    host: 'default',
                    port: 1234
                }
            ]
        });
        var route = purger._lookupRoute('http://test.com');
        assert.deepEqual('123.123.123.123', route.host);
        assert.deepEqual(1234, route.port);
        var route2 = purger._lookupRoute('http://test2.com');
        assert.deepEqual('default', route2.host);
        assert.deepEqual(1234, route2.port);
    });

    it ('should send datagrams' ,function(done) {
        this.timeout(5000);
        var purger = new HTCPPurger({
            routes: [
                {
                    host: 'localhost',
                    port: 12345
                }
            ]
        });
        var server = dgram.createSocket('udp4');
        server.on("message", function (msg) {
            assert.deepEqual(referenceBuffer, msg);
            done();
        });
        server.bind(12345);
        return purger.purge(['test.com'])
        .delay(100)
        .then(function() {
            server.close();
        });
    });

    it ('should increase seq num of datagrams' ,function(done) {
        var purger = new HTCPPurger({
            routes: [
                {
                    host: 'localhost',
                    port: 12346
                }
            ]
        });
        var server = dgram.createSocket('udp4');
        var msgIdx = 1;
        server.on("message", function (msg) {
            if (msgIdx === 1) {
                assert.deepEqual(referenceBuffer, msg);
                msgIdx++;
            } else {
                assert.deepEqual(referenceBuffer2, msg);
                done();
            }
        });
        server.bind(12346);

        return purger.purge(['test.com'])
        .delay(100)
        .then(function() {
            return purger.purge(['test.com']);
        })
        .delay(100)
        .then(function() { server.close(); })
    });
});