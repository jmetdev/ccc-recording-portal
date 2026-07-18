FROM quay.io/keycloak/keycloak:26.0

USER root
RUN microdnf install -y postgresql && microdnf clean all
COPY themes/ /opt/keycloak/themes/
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
USER keycloak

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["start"]
