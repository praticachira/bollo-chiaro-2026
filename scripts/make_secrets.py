import secrets
print('APP_SECRET='+secrets.token_urlsafe(48))
print('PROVISION_SECRET='+secrets.token_urlsafe(48))
