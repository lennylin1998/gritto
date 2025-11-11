# Use the official Nginx image
FROM nginx:alpine

# Copy your static site into Nginx’s web root
COPY . /usr/share/nginx/html

# Expose port 8080 (Cloud Run expects this)
EXPOSE 8080

# Override default Nginx config to listen on port 8080
RUN sed -i 's/80/8080/g' /etc/nginx/conf.d/default.conf
