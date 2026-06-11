FROM nginx:alpine

# nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Angular dist (built on host, copied into container)
COPY dist/browser /usr/share/nginx/html/kpikorat

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
