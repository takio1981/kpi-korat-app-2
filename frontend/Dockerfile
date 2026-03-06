# Stage 1: Serve the application with Nginx
FROM nginx:alpine

# 1. Copy custom Nginx configuration
# This file configures Nginx to serve the Angular app correctly,
# handle routing, and proxy API requests.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 2. Copy the pre-built Angular application
# The user builds the app on the host, and we copy the output (`dist/browser`)
# into the `/kpikorat` subdirectory to match the base-href and Nginx config.
COPY dist/browser /usr/share/nginx/html/kpikorat

# Expose port 80 for the web server
EXPOSE 80

# The default Nginx command will be run, which starts the server.
CMD ["nginx", "-g", "daemon off;"]
