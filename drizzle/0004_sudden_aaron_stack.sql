ALTER TABLE `books` MODIFY COLUMN `pdfFileUrl` varchar(1024) NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` MODIFY COLUMN `thumbnailUrl` varchar(1024);--> statement-breakpoint
ALTER TABLE `pages` MODIFY COLUMN `generatedImageUrl` varchar(1024);