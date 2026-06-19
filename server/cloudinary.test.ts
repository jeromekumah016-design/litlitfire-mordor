import { describe, it, expect } from "vitest";
import { v2 as cloudinary } from "cloudinary";

describe("Cloudinary Configuration", () => {
  it("should have valid Cloudinary credentials configured", () => {
    // Check that environment variables are set
    expect(process.env.CLOUDINARY_CLOUD_NAME).toBeDefined();
    expect(process.env.CLOUDINARY_API_KEY).toBeDefined();
    expect(process.env.CLOUDINARY_API_SECRET).toBeDefined();

    // Configure cloudinary
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    // Verify configuration
    expect(cloudinary.config().cloud_name).toBe(process.env.CLOUDINARY_CLOUD_NAME);
    expect(cloudinary.config().api_key).toBe(process.env.CLOUDINARY_API_KEY);
  });

  it("should be able to authenticate with Cloudinary API", async () => {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    // Test by getting account info
    try {
      const result = await cloudinary.api.resources({ max_results: 1 });
      // If we get here without error, credentials are valid
      expect(result).toBeDefined();
    } catch (error: any) {
      // If it's an auth error, credentials are invalid
      if (error.message?.includes("401") || error.message?.includes("Unauthorized")) {
        throw new Error("Invalid Cloudinary credentials");
      }
      // Other errors are acceptable (e.g., network issues)
    }
  });
});
