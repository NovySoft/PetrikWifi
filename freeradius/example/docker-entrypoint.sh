#!/bin/sh
set -e

PATH=/opt/sbin:/opt/bin:$PATH
export PATH

# Make configs read only
chmod o-w /opt/etc/raddb/clients.conf
chmod o-w /opt/etc/raddb/sites-available/default
chmod o-w /opt/etc/raddb/mods-config/files/authorize
chmod o-w /opt/etc/raddb/sites-available/inner-tunnel

chmod o-w /opt/etc/raddb/mods-available/eap
chmod o-w /opt/etc/raddb/mods-available/inner-eap
ln -s /opt/etc/raddb/mods-available/inner-eap /opt/etc/raddb/mods-enabled/inner-eap || true

# Enable rest module
chmod o-w /opt/etc/raddb/mods-available/rest
ln -s /opt/etc/raddb/mods-available/rest /opt/etc/raddb/mods-enabled/rest || true

# Enable status site
chmod o-w /opt/etc/raddb/sites-available/status
ln -s /opt/etc/raddb/sites-available/status /opt/etc/raddb/sites-enabled/status || true

# Secure certs
chmod o-w /opt/etc/raddb/certs/*.pem
chmod o-w /opt/etc/raddb/certs/*.key
chmod o-w /opt/etc/raddb/certs/*.p12
chmod o-w /opt/etc/raddb/certs/*.crt
chmod o-w /opt/etc/raddb/certs/*.csr
chmod o-w /opt/etc/raddb/certs/dh

rm /opt/etc/raddb/mods-enabled/files || true
sed "s/IDHERE/$RADTEST_USER/g" eapol_test.conf.template | sed -e "s/PASSHERE/$RADTEST_PASS/g" > /eapol_test.conf

apk update
apk add wpa_supplicant tzdata

# this if will check if the first argument is a flag
# but only works if all arguments require a hyphenated flag
# -v; -SL; -f arg; etc will work, but not arg1 arg2
if [ "$#" -eq 0 ] || [ "${1#-}" != "$1" ]; then
    set -- radiusd "$@"
fi

# check for the expected command
if [ "$1" = 'radiusd' ]; then
    shift
    exec radiusd -f "$@"
fi

# debian people are likely to call "freeradius" as well, so allow that
if [ "$1" = 'freeradius' ]; then
    shift
    exec radiusd -f "$@"
fi

# else default to run whatever the user wanted like "bash" or "sh"
exec "$@"
