CREATE TABLE `books` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`pdfFileKey` varchar(255) NOT NULL,
	`pdfFileUrl` varchar(512) NOT NULL,
	`pageCount` int NOT NULL,
	`processingStatus` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`totalPrice` decimal(10,2) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `books_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookId` int NOT NULL,
	`pageNumber` int NOT NULL,
	`thumbnailFileKey` varchar(255),
	`thumbnailUrl` varchar(512),
	`ocrText` text,
	`generatedPrompt` text,
	`generatedImageFileKey` varchar(255),
	`generatedImageUrl` varchar(512),
	`processingStatus` enum('pending','processing','done','error') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `processingJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookId` int NOT NULL,
	`pageId` int,
	`jobType` enum('extract_pdf','ocr','generate_prompt','generate_image') NOT NULL,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`result` text,
	`errorMessage` text,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `processingJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `userIdIdx` ON `books` (`userId`);--> statement-breakpoint
CREATE INDEX `statusIdx` ON `books` (`processingStatus`);--> statement-breakpoint
CREATE INDEX `bookIdIdx` ON `pages` (`bookId`);--> statement-breakpoint
CREATE INDEX `statusIdx` ON `pages` (`processingStatus`);--> statement-breakpoint
CREATE INDEX `bookPageIdx` ON `pages` (`bookId`,`pageNumber`);--> statement-breakpoint
CREATE INDEX `bookIdIdx` ON `processingJobs` (`bookId`);--> statement-breakpoint
CREATE INDEX `statusIdx` ON `processingJobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobTypeIdx` ON `processingJobs` (`jobType`);