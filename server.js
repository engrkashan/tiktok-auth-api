const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");
const fs = require("fs");
const upload = multer();
const axios = require("axios");
const FormData = require("form-data");
require("dotenv").config();

const app = express();
const PORT = 3000;

// TikTok API credentials and URLs
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI =
  process.env.REDIRECT_URI ||
  "https://2fa5-223-123-93-1.ngrok-free.app/auth/callback";
const API_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const SCOPE = "user.info.basic,video.publish,video.upload";

app.use(bodyParser.json());

// Home route
app.get("/", (req, res) => {
  res.send("TikTok Auth and Video Sharing API");
});

// Step 1: Redirect to TikTok for user authentication
app.get("/auth", (req, res) => {
  const csrfState = Math.random().toString(36).substring(2); // Generate a CSRF state
  const params = new URLSearchParams({
    client_key: CLIENT_ID,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: REDIRECT_URI,
    state: csrfState,
  });

  res.redirect(`${AUTH_URL}?${params.toString()}`);
});

// Step 2: Handle TikTok callback and exchange code for access token
// Step 2: Handle TikTok callback and exchange code for access token
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: "Authorization code not found" });
  }

  try {
    // Use 'x-www-form-urlencoded' for the body
    const params = new URLSearchParams();
    params.append("client_key", CLIENT_ID);
    params.append("client_secret", CLIENT_SECRET);
    params.append("code", code);
    params.append("grant_type", "authorization_code");
    params.append("redirect_uri", REDIRECT_URI);

    const response = await axios.post(API_URL, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    // Debug TikTok API response
    console.log("TikTok API Response:", response.data);

    if (response.data && response.data.data) {
      const { access_token, refresh_token } = response.data.data;
      return res.json({
        message: "Authentication successful",
        access_token,
        refresh_token,
      });
    } else {
      return res.status(500).json({
        error: "Unexpected response from TikTok API",
        details: response.data,
      });
    }
  } catch (error) {
    console.error(
      "Error during token exchange:",
      error.response?.data || error.message
    );
    return res
      .status(500)
      .json({ error: error.response?.data || error.message });
  }
});

// Step 3: Refresh access token
app.post("/refresh-token", async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({ error: "Missing refresh token" });
  }

  try {
    const params = new URLSearchParams();
    params.append("client_key", CLIENT_ID);
    params.append("client_secret", CLIENT_SECRET);
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refresh_token);

    const response = await axios.post(API_URL, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (response.data && response.data.data) {
      return res.json(response.data.data);
    } else {
      return res.status(500).json({
        error: "Unexpected response from TikTok API",
        details: response.data,
      });
    }
  } catch (error) {
    console.error(
      "Error during token refresh:",
      error.response?.data || error.message
    );
    return res
      .status(500)
      .json({ error: error.response?.data || error.message });
  }
});

// Step 4: Fetch user info
app.post("/user-info", async (req, res) => {
  const { access_token } = req.body;

  if (!access_token) {
    return res.status(400).json({ error: "Missing access token" });
  }

  try {
    // Define the API URL with required fields
    const apiUrl =
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name";

    // Make the API call
    const response = await axios.get(apiUrl, {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    // Check and return the response data
    if (response.data) {
      return res.json({
        message: "User profile fetched successfully",
        data: response.data,
      });
    } else {
      return res.status(500).json({
        error: "Unexpected response from TikTok API",
        details: response.data,
      });
    }
  } catch (error) {
    console.error(
      "Error fetching user info:",
      error.response?.data || error.message
    );
    return res
      .status(500)
      .json({ error: error.response?.data || error.message });
  }
});

// Step 5: Upload video
app.post("/upload-video", upload.single("video"), async (req, res) => {
  const { access_token } = req.body;

  if (!access_token || !req.file) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const videoSize = req.file.size;
    const maxChunkSize = 64 * 1024 * 1024; // 64 MB
    const chunkSize = Math.min(videoSize, maxChunkSize);
    const totalChunkCount = Math.ceil(videoSize / chunkSize);

    console.log(
      `Initializing upload: videoSize=${videoSize}, chunkSize=${chunkSize}, totalChunkCount=${totalChunkCount}`
    );

    // Step 1: Initialize the upload
    const initResponse = await axios.post(
      "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
      {
        source_info: {
          source: "FILE_UPLOAD",
          video_size: videoSize,
          chunk_size: chunkSize,
          total_chunk_count: totalChunkCount,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      }
    );

    const { upload_url } = initResponse.data.data;
    console.log("Upload URL:", upload_url);

    if (!upload_url) {
      throw new Error("Invalid upload URL returned from TikTok");
    }

    // Step 2: Upload chunks
    const videoBuffer = req.file.buffer;

    for (let i = 0; i < totalChunkCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, videoSize);
      const chunk = videoBuffer.slice(start, end);

      const contentRange = `bytes ${start}-${end - 1}/${videoSize}`;
      console.log(`Uploading chunk ${i + 1}/${totalChunkCount}:`, contentRange);

      await uploadChunkWithRetry(upload_url, chunk, {
        "Content-Type": "video/mp4",
        "Content-Length": chunk.length,
        "Content-Range": contentRange,
      });
    }

    // Step 3: Finalize the upload
    const finalizeResponse = await axios.post(`${upload_url}/finalize`, null, {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    console.log("Finalize response:", finalizeResponse.data);

    res.json({
      message: "Video uploaded and finalized successfully",
      finalizeResponse: finalizeResponse.data,
    });
  } catch (error) {
    if (
      error.response &&
      error.response.data &&
      error.response.data.error &&
      error.response.data.error.code === "spam_risk_too_many_pending_share"
    ) {
      console.error("Error: Too many pending uploads.");
      return res.status(429).json({
        error:
          "Too many pending uploads. Please complete or cancel existing uploads on TikTok.",
      });
    }

    console.error(
      "Error during video upload:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
