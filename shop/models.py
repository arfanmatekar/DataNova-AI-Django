from django.db import models
from django.contrib.auth.models import User

class Product(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField()
    price = models.IntegerField()

    image = models.ImageField(
        upload_to='products/',
        blank=True,
        null=True
    )

    def __str__(self):
        return self.name


class Cart(models.Model):
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE
    )

    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE
    )

    quantity = models.IntegerField(default=1)

    def __str__(self):
        return self.product.name


class Order(models.Model):
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE
    )

    total_price = models.DecimalField(
        max_digits=10,
        decimal_places=2
    )

    status = models.CharField(
        max_length=50,
        default='Pending'
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    def __str__(self):
        return f"Order {self.id}"


class DataNovaProject(models.Model):
    class Status(models.TextChoices):
        PLANNING = 'planning', 'Planning'
        ACTIVE = 'active', 'Active'
        COMPLETED = 'completed', 'Completed'

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='datanova_projects',
    )
    name = models.CharField(max_length=80)
    description = models.TextField(blank=True, max_length=2000)
    status = models.CharField(
        max_length=12,
        choices=Status.choices,
        default=Status.PLANNING,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at', '-id']

    def __str__(self):
        return self.name


class ProjectDataset(models.Model):
    project = models.OneToOneField(
        DataNovaProject,
        on_delete=models.CASCADE,
        related_name='dataset',
    )
    filename = models.CharField(max_length=255)
    columns = models.JSONField(default=list)
    rows = models.JSONField(default=list)
    uploaded_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.filename} — {self.project.name}'


class LearningMilestone(models.Model):
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='datanova_milestones',
    )
    title = models.CharField(max_length=120)
    description = models.CharField(max_length=240)
    completed = models.BooleanField(default=False)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['position', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'title'],
                name='unique_user_datanova_milestone',
            ),
        ]

    def __str__(self):
        return f'{self.title} — {self.user}'