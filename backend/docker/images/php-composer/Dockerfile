# Troxe platform image: PHP CLI with Composer available.
#
# WHY THIS EXISTS
# The official `php:8.3-cli` image ships NO composer, NO git and NO unzip
# (verified by probing the image directly). Without composer the landing
# page's "PHP 8.x with Composer, Laravel, Symfony" cannot be delivered at all,
# and the previous code quietly pretended it worked by telling PHP clients to
# upload a pre-built `vendor/` directory.
#
# WHY IT IS A BUILT IMAGE AND NOT A RUNTIME DOWNLOAD
# The alternative was fetching getcomposer.org inside the sandbox and running
# it. That executes unreviewed remote code on every start, and the security
# rules for this platform forbid exactly that. Composer is therefore installed
# HERE, at build time, where the source is pinned and reviewable, and the
# resulting image is pinned BY DIGEST in the catalog like every other image.
#
# Install composer, verifying the download against a checksum that was taken
# from upstream (composer.github.io / getcomposer.org), NOT invented. A build
# that cannot match the checksum fails loudly instead of installing whatever
# the network happened to return.
ARG COMPOSER_VERSION=2.8.10
ARG COMPOSER_SHA256=28dbb6bd8bef31479c7985b774c130a8bda37dbe63c35b56f6cb6bc377427573

FROM php:8.3-cli-bookworm

# ARGs declared before FROM are only in scope for FROM itself; they must be
# re-declared inside the stage or they expand to an empty string (which turned
# the download URL into `.../download//composer.phar` → HTTP 404 → curl exit 22).
ARG COMPOSER_VERSION=2.8.10
ARG COMPOSER_SHA256=28dbb6bd8bef31479c7985b774c130a8bda37dbe63c35b56f6cb6bc377427573

# git: Composer clones VCS packages. unzip: Composer extracts dist archives.
# Both are hard requirements of `composer install`, not conveniences.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://getcomposer.org/download/${COMPOSER_VERSION}/composer.phar" -o /tmp/composer.phar \
 && echo "${COMPOSER_SHA256}  /tmp/composer.phar" | sha256sum -c - \
 && install -m 0755 /tmp/composer.phar /usr/local/bin/composer \
 && rm -f /tmp/composer.phar \
 && composer --version

# Composer must be able to write its cache, but the sandbox rootfs is
# read-only. $HOME is /data in the sandbox, and COMPOSER_HOME is set by the
# catalog's env so the cache lands on the persistent volume.
ENV COMPOSER_HOME=/data/.composer \
    COMPOSER_ALLOW_SUPERUSER=0

WORKDIR /data