FROM node:20.20.2-alpine3.22 AS vendor-builder
WORKDIR /app

LABEL org.opencontainers.image.title="KI-Korrektur Dashboard" \
      org.opencontainers.image.description="Dashboard zur Visualisierung KI-korrigierter Sensorwerte im Projekt Urban Climate Twin Soest" \
      org.opencontainers.image.documentation="https://github.com/fhswf/KI-Korrektur-dashboard/blob/main/README.md" \
      org.opencontainers.image.url="https://www.fh-swf.de/de/forschung___transfer_4/forschungsprojekte_1/forschungsprojekt_uct.php" \
      org.opencontainers.image.source="https://github.com/fhswf/KI-Korrektur-dashboard" \
      org.opencontainers.image.licenses="Apache-2.0" \ 
      org.opencontainers.image.authors="Marius Kroel" \
      org.opencontainers.image.vendor="FH Südwestfalen – University of Applied Sciences"

COPY package*.json ./
RUN npm ci

RUN mkdir -p \
    public/vendor/leaflet \
    public/vendor/chartjs \
    public/vendor/date-fns \
    public/vendor/chartjs-adapter \
    public/vendor/hammerjs \
    public/vendor/chartjs-zoom

RUN cp node_modules/leaflet/dist/leaflet.css           public/vendor/leaflet/ && \
    cp node_modules/leaflet/dist/leaflet.js            public/vendor/leaflet/ && \
    cp node_modules/chart.js/dist/chart.umd.min.js     public/vendor/chartjs/ && \
    cp node_modules/date-fns/cdn.min.js                public/vendor/date-fns/ && \
    cp node_modules/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js \
                                                        public/vendor/chartjs-adapter/ && \
    cp node_modules/hammerjs/hammer.min.js             public/vendor/hammerjs/ && \
    cp node_modules/chartjs-plugin-zoom/dist/chartjs-plugin-zoom.min.js \
                                                        public/vendor/chartjs-zoom/

# Get production dependencies
FROM node:20.20.2-alpine3.22 AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Final image
FROM node:20.20.2-alpine3.22
WORKDIR /app

# nginx setup
RUN apk add --no-cache nginx

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=vendor-builder /app/public/vendor ./public/vendor/
COPY server.js .
COPY package.json .
COPY src/ ./src/
COPY public/ ./public/
COPY nginx.conf /etc/nginx/nginx.conf

RUN mkdir -p /tmp/nginx_cache /var/lib/nginx/tmp && \
    chown -R node:node /var/lib/nginx /var/log/nginx /tmp

RUN echo "#!/bin/sh" > /app/start.sh && \
    echo "nginx -e /tmp/nginx_error.log -g 'daemon off;' &" >> /app/start.sh && \
    echo "node server.js" >> /app/start.sh && \
    chmod +x /app/start.sh

USER node
EXPOSE 8443
CMD ["/app/start.sh"]
