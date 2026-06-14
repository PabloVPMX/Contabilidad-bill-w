FROM node:20-alpine

WORKDIR /app

# Instalar dependencias primero (mejor uso de la caché de capas)
COPY package.json ./
RUN npm install --omit=dev

# Copiar el resto de la aplicación
COPY . .

# Volumen persistente para la base de datos JSON
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "server.js"]
