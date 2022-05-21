.PHONY: launch
launch: shutdown
	yarn codegen
	yarn build
	docker-compose up -d
	docker-compose logs -f

.PHONY: launch-heiko
launch-heiko: shutdown
	yarn codegen
	yarn build
	MANIFEST_FILE=heiko.yaml docker-compose up -d
	docker-compose logs -f

.PHONY: launch-parallel
launch-parallel: shutdown
	yarn codegen
	yarn build
	MANIFEST_FILE=parallel.yaml docker-compose up -d
	docker-compose logs -f

.PHONY: shutdown
shutdown:
	docker-compose down --remove-orphans
	sudo rm -fr .data
