/**
 * Renders the docker-compose.yml for Docktor's own managed reverse-proxy
 * stack (nginx-proxy + acme-companion). Unlike every other stack's compose
 * content — which always comes from the user — this file is generated and
 * owned by Docktor itself (D-02), so it is built as a template literal
 * rather than edited via the yaml Document API's targeted-mutation pattern
 * (compose-editor.ts/compose-proxy-editor.ts): there is no prior on-disk
 * content to preserve here.
 *
 * PROXY_CERTS_SUBPATH is the single definition of where issued certs live
 * on disk relative to this stack's directory — 06-04's cert poller resolves
 * the certs directory as path.join(getStackPath(PROXY_STACK_ID), PROXY_CERTS_SUBPATH).
 */

export const NGINX_PROXY_IMAGE = "nginxproxy/nginx-proxy:1.11-alpine";
export const ACME_COMPANION_IMAGE = "nginxproxy/acme-companion:2.6.3";
export const NGINX_PROXY_CONTAINER_NAME = "docktor-proxy-nginx";
export const ACME_COMPANION_CONTAINER_NAME = "docktor-proxy-acme";
export const PROXY_CERTS_SUBPATH = "volumes/certs";

export interface RenderProxyStackComposeOptions {
    acmeEmail: string;
}

/**
 * Renders the nginx-proxy + acme-companion compose file. The ACME email is
 * emitted as a `DEFAULT_EMAIL` env var only when non-empty (D-09 — no
 * registration email is required) and always as a JSON.stringify'd YAML
 * double-quoted scalar, so no input (newlines, quotes, YAML indicator
 * characters) can break out of the scalar — the second line of defence
 * behind SettingsService.updateProxySettings()'s Zod email validation.
 */
export function renderProxyStackCompose(options: RenderProxyStackComposeOptions): string {
    const {acmeEmail} = options;
    const defaultEmailLine = acmeEmail
        ? `      DEFAULT_EMAIL: ${JSON.stringify(acmeEmail)}\n`
        : "";

    return `# This file is generated and owned by Docktor. Editing it by hand can
# break routing and TLS for every proxied service, and Docktor may
# overwrite your changes on the next ACME email update or proxy-stack
# redeploy.
services:
  nginx-proxy:
    image: ${NGINX_PROXY_IMAGE}
    container_name: ${NGINX_PROXY_CONTAINER_NAME}
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./volumes/certs:/etc/nginx/certs:ro
      - ./volumes/html:/usr/share/nginx/html
      - ./volumes/vhost.d:/etc/nginx/vhost.d
      # Docker socket (read-only) — allows nginx-proxy to watch container
      # events on the host and regenerate vhost config automatically. This
      # grants the container host-root-equivalent reach: anyone who can
      # exec into this container can control every container on the host.
      - /var/run/docker.sock:/tmp/docker.sock:ro
    networks:
      - docktor_proxy

  acme-companion:
    image: ${ACME_COMPANION_IMAGE}
    container_name: ${ACME_COMPANION_CONTAINER_NAME}
    restart: unless-stopped
    depends_on:
      - nginx-proxy
    environment:
      NGINX_PROXY_CONTAINER: ${NGINX_PROXY_CONTAINER_NAME}
${defaultEmailLine}    volumes:
      - ./volumes/certs:/etc/nginx/certs:rw
      - ./volumes/html:/usr/share/nginx/html:rw
      - ./volumes/vhost.d:/etc/nginx/vhost.d:rw
      - ./volumes/acme:/etc/acme.sh
      # Docker socket (read-only) — allows acme-companion to discover
      # certificate-requesting containers and signal nginx-proxy after
      # issuing a certificate. This grants the container
      # host-root-equivalent reach: anyone who can exec into this
      # container can control every container on the host.
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - docktor_proxy

networks:
  docktor_proxy:
    name: docktor_proxy
`;
}
