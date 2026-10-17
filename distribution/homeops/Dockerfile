FROM ghcr.io/hotio/whisparr:v3@sha256:4edd949338a80cf256cb968ec2127d77023df1b6a2c5248b180773dd91853d20
ARG REVISION
ARG VERSION=3.6.5.1887
LABEL org.opencontainers.image.source="https://gitlab.ahn.io/a-huy/whisparr" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.version="${VERSION}-homeops" \
      io.homenet.whisparr.fork="true"
# Keep Hotio's container integration; replace the complete application, including UI.
RUN rm -rf /app/bin && mkdir -p /app/bin
COPY bin/ /app/bin/
RUN chmod 0755 /app/bin/Whisparr /app/bin/ffprobe
ENV WHISPARR__UPDATE__MECHANISM=Docker \
    WHISPARR__UPDATE__AUTOMATICALLY=false
