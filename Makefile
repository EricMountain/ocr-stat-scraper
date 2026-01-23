LAMBDA_NAME ?= ocr-stat-scraper

.PHONY: build-web sync-dist package terraform-init terraform-plan terraform-apply clean audit-fix

build-web:
	npm --prefix pwa install
	npm --prefix pwa run build

sync-dist: build-web
	rm -rf lambda/dist
	cp -r pwa/dist lambda/dist

package: sync-dist
	@echo "Source ready; terraform will build the archive via archive_file."

terraform-init:
	cd terraform/aws && terraform init

terraform-plan: package terraform-init
	cd terraform/aws && terraform plan

terraform-apply: package terraform-init
	cd terraform/aws && terraform apply -auto-approve

clean:
	rm -f terraform/aws/lambda.zip
	rm -rf lambda/dist

audit-fix:
	npm --prefix pwa install
	npm --prefix pwa audit fix
	npm --prefix pwa update
