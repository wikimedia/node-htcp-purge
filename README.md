# HTCP multicast purge client for Squid and Varnish

The implementation slightly deviates from [the HTCP standard](htcp) 
to be compatible with Squid and [the Wikimedia Varnish setup][purge]. Purges
are distributed via UDP multicast.

[htcp]: https://en.wikipedia.org/wiki/Hypertext_caching_protocol
[purge]: https://wikitech.wikimedia.org/wiki/Multicast_HTCP_purging
