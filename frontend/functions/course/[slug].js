const fallbackImage = "https://dylnd2lqy6eys.cloudfront.net/1770981347/admin_v2/uploads/courses/thumbnail/7275359_125_abhay%2010th%20banner%20app%202026.png";

function slugify(title) {
  return String(title || "course").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function titleFromSlug(slug) {
  return String(slug || "Courses").split("-").filter(Boolean)
    .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); }).join(" ") || "Courses";
}

function updateMeta(value) {
  return {
    element: function (element) {
      element.setAttribute("content", value);
    }
  };
}

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const pageResponse = await context.env.ASSETS.fetch(new URL("/content.html", requestUrl.origin));
  if (!pageResponse.ok) {
    return new Response("Course page is unavailable.", { status: 502 });
  }

  const catalogResponse = await context.env.ASSETS.fetch(new URL("/batches.json", requestUrl.origin));
  if (!catalogResponse.ok) {
    return new Response("Course catalog is unavailable.", { status: 502 });
  }

  const catalog = await catalogResponse.json();
  const batches = [].concat(catalog.new || [], catalog.old || []);
  const slug = String(context.params.slug || "");
  const batch = batches.find(function (entry) { return slugify(entry.title) === slug; });
  const title = batch ? batch.title : titleFromSlug(slug);
  const description = batch
    ? "Explore lessons, notes and live classes for " + batch.title + " on StudiKitEZ."
    : "Browse lessons, notes and live classes on StudiKitEZ.";
  const image = batch && typeof batch.thumbnail === "string" && batch.thumbnail.startsWith("https://")
    ? batch.thumbnail
    : fallbackImage;
  const canonicalUrl = requestUrl.origin + requestUrl.pathname;

  return new HTMLRewriter()
    .on("title", {
      element: function (element) {
        element.setInnerContent(title + " | StudiKitEZ");
      }
    })
    .on('meta[name="description"]', updateMeta(description))
    .on('meta[property="og:title"]', updateMeta(title + " | StudiKitEZ"))
    .on('meta[property="og:description"]', updateMeta(description))
    .on('meta[property="og:image"]', updateMeta(image))
    .on('meta[property="og:url"]', updateMeta(canonicalUrl))
    .on('meta[property="og:image:alt"]', updateMeta(title))
    .on('meta[name="twitter:title"]', updateMeta(title + " | StudiKitEZ"))
    .on('meta[name="twitter:description"]', updateMeta(description))
    .on('meta[name="twitter:image"]', updateMeta(image))
    .on('link[rel="canonical"]', {
      element: function (element) {
        element.setAttribute("href", canonicalUrl);
      }
    })
    .transform(pageResponse);
}
