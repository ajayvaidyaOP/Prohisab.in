package com.depositin.erp.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** MVC configuration (same-origin deployment behind Nginx; no cross-origin CORS needed). */
@Configuration
public class WebConfig implements WebMvcConfigurer {
}
