.PHONY: restart
restart: shutdown
	yarn codegen
	yarn build
	docker-compose up -d
	docker-compose logs -f

.PHONY: shutdown
shutdown:
	docker-compose down --remove-orphans
	sudo rm -fr .data
