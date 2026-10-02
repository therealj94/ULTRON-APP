# El puente de WhatsApp de AU-RA (servicio privado de Render, con disco en /data).
FROM golang:1.26-bookworm AS construir
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /puente .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata && rm -rf /var/lib/apt/lists/*

COPY --from=construir /puente /usr/local/bin/puente
ENV DATOS=/data PORT=8080
EXPOSE 8080
CMD ["/usr/local/bin/puente"]
